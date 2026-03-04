const createServer = require('./createServer');
const packageJson = require('./package.json');

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const VERSION = packageJson.version;

const { server } = createServer();

server.listen(PORT, HOST, () => {
  console.log(`Skip-Bo server v${VERSION} running on http://${HOST}:${PORT}`);
  console.log(`For local network access, use your machine's IP address instead of ${HOST}`);
});
