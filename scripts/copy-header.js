const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', 'src', 'header');
const destination = path.join(__dirname, '..', 'tsc', 'header');

if (fs.existsSync(destination)) {
    fs.rmSync(destination, { recursive: true, force: true });
}

fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.cpSync(source, destination, { recursive: true });
