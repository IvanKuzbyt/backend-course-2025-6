const { program } = require('commander');
const fs = require('fs');
const http = require('http');

program
  .requiredOption('-h, --host <host>', 'Server host')
  .requiredOption('-p, --port <port>', 'Server port')
  .requiredOption('-c, --cache <path>', 'Cache directory');

program.parse();

const options = program.opts();


if (!fs.existsSync(options.cache)) {
    fs.mkdirSync(options.cache);
    console.log("Cache directory created");
}

const server = http.createServer((req, res) => {

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');

    res.end("Inventory server is running");

});

server.listen(options.port, options.host, () => {

    console.log("Server started");
    console.log("Host:", options.host);
    console.log("Port:", options.port);
    console.log("Cache:", options.cache);

});