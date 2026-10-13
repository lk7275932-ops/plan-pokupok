// Только локальная разработка/QA. Не включать в размещаемые файлы приложения.
const crypto=require('node:crypto');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
async function startServer(port=4173){
  const root=path.resolve(__dirname,'..'),config=new Map();
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/_qa/control'&&req.method==='POST'){
        let body='';for await(const chunk of req)body+=chunk;
        const data=JSON.parse(body),scope=data.scope||'/';config.set(scope,data.reset?{}:{...config.get(scope),...data});res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');return;
      }
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
      let pathname=decodeURIComponent(url.pathname),scope=pathname.startsWith('/nested/')?'/nested/':'/';
      if(pathname==='/nested'){res.writeHead(302,{Location:'/nested/'});res.end();return;}
      if(scope==='/nested/')pathname=pathname.slice('/nested'.length);
      const relative=pathname==='/'?'index.html':pathname.slice(1),file=path.resolve(root,relative);
      if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
      const mode=config.get(scope)||{};
      if(mode.redirectIndex&&pathname==='/index.html'){res.writeHead(307,{Location:scope});res.end();return;}
      if(mode.fail===relative){res.writeHead(503);res.end('QA: unavailable');return;}
      let bytes=await fs.readFile(file);
      if(relative==='style.css'&&mode.cssMarker)bytes=Buffer.concat([bytes,Buffer.from('\n/* '+mode.cssMarker+' */')]);
      if(relative==='sw.js'){
        let source=bytes.toString();
        if(mode.version)source=source.replace(/const VERSION='[^']+';/,`const VERSION='${mode.version}';`);
        if(mode.cssMarker&&!mode.staleHashes){const css=Buffer.concat([await fs.readFile(path.join(root,'style.css')),Buffer.from('\n/* '+mode.cssMarker+' */')]);const hash=crypto.createHash('sha256').update(css).digest('hex');source=source.replace(/(\"style.css\":\")[a-f0-9]+/,`$1${hash}`);}
        bytes=Buffer.from(source);
      }
      const mime={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.html':'text/html; charset=utf-8'}[path.extname(file)]||'text/plain; charset=utf-8';
      res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:bytes);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));return server;
}
module.exports=startServer;
if(require.main===module)startServer().then(()=>console.log('http://127.0.0.1:4173'));
