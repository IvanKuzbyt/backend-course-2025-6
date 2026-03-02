const { program } = require('commander');
const fs = require('fs');
const http = require('http');
const path = require('path');

program
    .requiredOption('-h, --host <host>')
    .requiredOption('-p, --port <port>')
    .requiredOption('-c, --cache <path>');

program.parse();
const options = program.opts();

// Створення папки кешу
if (!fs.existsSync(options.cache)) {
    fs.mkdirSync(options.cache, { recursive: true });
}

let inventory = [];
let nextId = 1;

/**
 * Допоміжна функція для парсингу multipart/form-data (чистий Buffer)
 */
function parseMultipart(buffer, boundary) {
    const parts = [];
    const delimiter = Buffer.from(`--${boundary}`);
    let start = buffer.indexOf(delimiter) + delimiter.length;

    while (start < buffer.length) {
        let end = buffer.indexOf(delimiter, start);
        if (end === -1) break;

        const part = buffer.slice(start, end);
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
            const header = part.slice(0, headerEnd).toString();
            const body = part.slice(headerEnd + 4, part.length - 2); // -2 для \r\n
            const nameMatch = header.match(/name="([^"]+)"/);
            const filenameMatch = header.match(/filename="([^"]+)"/);
            
            parts.push({
                name: nameMatch ? nameMatch[1] : null,
                filename: filenameMatch ? filenameMatch[1] : null,
                data: body
            });
        }
        start = end + delimiter.length;
    }
    return parts;
}

const server = http.createServer((req, res) => {
    const { method, url } = req;

    // --- СТАТИЧНІ ФОРМИ ---
    if (method === "GET" && url === "/RegisterForm.html") {
        if (!fs.existsSync("RegisterForm.html")) { res.statusCode = 404; return res.end(); }
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end(fs.readFileSync("RegisterForm.html"));
    }

    if (method === "GET" && url === "/SearchForm.html") {
        if (!fs.existsSync("SearchForm.html")) { res.statusCode = 404; return res.end(); }
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end(fs.readFileSync("SearchForm.html"));
    }

    // --- INVENTORY API ---
    if (url === "/inventory") {
        if (method === "GET") {
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify(inventory));
        }
        res.statusCode = 404; return res.end();
    }

    // POST /register
    if (method === "POST" && url === "/register") {
        let chunks = [];
        req.on("data", chunk => chunks.push(chunk));
        req.on("end", () => {
            const buffer = Buffer.concat(chunks);
            const contentType = req.headers['content-type'];
            const boundary = contentType.split('boundary=')[1];
            
            const parts = parseMultipart(buffer, boundary);
            const namePart = parts.find(p => p.name === "inventory_name");
            const descPart = parts.find(p => p.name === "description");
            const photoPart = parts.find(p => p.name === "photo");

            if (!namePart || !namePart.data.toString().trim()) {
                res.statusCode = 400;
                return res.end("Bad Request: inventory_name is required");
            }

            const id = nextId++;
            const name = namePart.data.toString().trim();
            const description = descPart ? descPart.data.toString().trim() : "";
            
            let photoUrl = null;
            if (photoPart && photoPart.data.length > 0) {
                const photoPath = path.join(options.cache, `${id}.jpg`);
                fs.writeFileSync(photoPath, photoPart.data);
                photoUrl = `/inventory/${id}/photo`;
            }

            inventory.push({ id, name, description, photo: photoUrl });
            res.statusCode = 201;
            res.end("Created");
        });
        return;
    }

    // POST /search (x-www-form-urlencoded)
    if (method === "POST" && url === "/search") {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => {
            const params = new URLSearchParams(body);
            const id = parseInt(params.get("id"));
            const has_photo = params.get("has_photo") === "on" || params.get("has_photo") === "true";

            const item = inventory.find(x => x.id === id);
            if (!item) {
                res.statusCode = 404;
                return res.end("Not Found");
            }

            let response = { ...item };
            if (has_photo && item.photo) {
                response.photo_link = item.photo;
            } else if (has_photo && !item.photo) {
                response.photo_link = "No photo available";
            }

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(response));
        });
        return;
    }

    // Ендпоінти з ID: /inventory/<ID>...
    const idMatch = url.match(/^\/inventory\/(\d+)(\/photo)?$/);
    if (idMatch) {
        const id = parseInt(idMatch[1]);
        const isPhotoSubpath = idMatch[2] === "/photo";
        const itemIndex = inventory.findIndex(x => x.id === id);

        if (itemIndex === -1) {
            res.statusCode = 404;
            return res.end("Not found");
        }

        const item = inventory[itemIndex];

        // GET /inventory/<ID>
        if (!isPhotoSubpath && method === "GET") {
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify(item));
        }

        // PUT /inventory/<ID>
        if (!isPhotoSubpath && method === "PUT") {
            let body = "";
            req.on("data", chunk => body += chunk);
            req.on("end", () => {
                try {
                    const data = JSON.parse(body);
                    if (data.inventory_name) item.name = data.inventory_name;
                    if (data.description) item.description = data.description;
                    res.statusCode = 200;
                    res.end("OK");
                } catch (e) {
                    res.statusCode = 400; res.end("Invalid JSON");
                }
            });
            return;
        }

        // DELETE /inventory/<ID>
        if (!isPhotoSubpath && method === "DELETE") {
            inventory.splice(itemIndex, 1);
            // Видаляємо файл фото, якщо він є
            const photoPath = path.join(options.cache, `${id}.jpg`);
            if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
            res.statusCode = 200;
            return res.end("Deleted");
        }

        // GET /inventory/<ID>/photo
        if (isPhotoSubpath && method === "GET") {
            const photoPath = path.join(options.cache, `${id}.jpg`);
            if (!fs.existsSync(photoPath)) {
                res.statusCode = 404;
                return res.end("Photo not found");
            }
            res.writeHead(200, { "Content-Type": "image/jpeg" });
            return res.end(fs.readFileSync(photoPath));
        }

        // PUT /inventory/<ID>/photo
        if (isPhotoSubpath && method === "PUT") {
            let chunks = [];
            req.on("data", chunk => chunks.push(chunk));
            req.on("end", () => {
                const photoPath = path.join(options.cache, `${id}.jpg`);
                fs.writeFileSync(photoPath, Buffer.concat(chunks));
                item.photo = `/inventory/${id}/photo`;
                res.statusCode = 200;
                res.end("Photo updated");
            });
            return;
        }

        // Якщо метод не підтримується для цього ID
        res.statusCode = 405;
        return res.end("Method not allowed");
    }

    // Всі інші випадки
    res.statusCode = 405;
    res.end("Method not allowed");
});

server.listen(options.port, options.host, () => {
    console.log(`Server running at http://${options.host}:${options.port}/`);
});