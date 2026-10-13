const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const notifications=[],sandbox={URL,Response,crypto:crypto.webcrypto,Uint8Array,self:{location:{href:'https://example.test/shop/sw.js'},addEventListener(){},clients:{async matchAll(){return [{postMessage(message){notifications.push(message.type);}}];}}}};
vm.createContext(sandbox);vm.runInContext(source+'\nglobalThis.releaseHashes=HASHES;globalThis.verifyFile=verified;',sandbox);
test('Хэши выпуска соответствуют всем шести реальным файлам',()=>{
  assert.equal(Object.keys(sandbox.releaseHashes).length,6);
  for(const [file,hash] of Object.entries(sandbox.releaseHashes))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),hash,file);
});
test('Каждый ресурс проверяется: оригинал допустим, изменение отвергается, включая query URL',async()=>{
  for(const file of Object.keys(sandbox.releaseHashes)){
    const bytes=fs.readFileSync(path.join(root,file)),url='https://example.test/shop/'+file;
    assert.equal(await sandbox.verifyFile(new Response(bytes),url),true,file);
    assert.equal(await sandbox.verifyFile(new Response(Buffer.concat([bytes,Buffer.from('changed')])),url+'?reload=1'),false,file);
  }
  assert.equal(await sandbox.verifyFile(new Response(fs.readFileSync(path.join(root,'index.html'))),'https://example.test/shop/?visit=1'),true);
  assert.equal(notifications.length,6);assert.ok(notifications.every(type=>type==='VERSION_MISMATCH'));
});
