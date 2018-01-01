const IRC = require('./lib/irc');

const server = IRC.createServer();

server.listen(6667, '127.0.0.1');


