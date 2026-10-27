import {spawn} from 'node:child_process';

// IPC closes even when the board's parent is terminated. Do not leave its public tunnel running.
const [binary,config,url]=process.argv.slice(2);
const helper=spawn(binary,['tunnel','--config',config,'--no-autoupdate','--url',url,'--protocol','http2'],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
helper.stdout.pipe(process.stdout);helper.stderr.pipe(process.stderr);
let ending=false;
const end=()=>{if(ending)return;ending=true;helper.kill();setTimeout(()=>process.exit(0),1000).unref();};
process.on('disconnect',end);process.on('message',message=>{if(message==='stop')end();});process.on('SIGTERM',end);process.on('SIGINT',end);
helper.on('error',()=>process.exit(1));helper.on('exit',code=>process.exit(code??0));
