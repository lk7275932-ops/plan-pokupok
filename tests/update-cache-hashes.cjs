// Инструмент выпуска, не файл приложения. Без зависимостей и сборки.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const files=['index.html','style.css','script.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png'];
const hashes=Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
const worker=path.join(root,'sw.js'),source=fs.readFileSync(worker,'utf8');
if(!/const HASHES=\{[^;]*\};/.test(source))throw Error('Не найден HASHES');
fs.writeFileSync(worker,source.replace(/const HASHES=\{[^;]*\};/,`const HASHES=${JSON.stringify(hashes)};`));
console.log('Обновлены SHA-256 шести файлов приложения');
