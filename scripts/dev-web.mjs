// Developer preview only. End users open https://sharedboard.app.
import {createServer} from 'vite';
process.env.VITE_STORAGE_MODE='browser';
process.env.VITE_RELAY_ORIGIN??='http://127.0.0.1:8787';
const server=await createServer({server:{host:'127.0.0.1',port:4317,strictPort:true}});
await server.listen();server.printUrls();
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await server.close();process.exit(0);});
