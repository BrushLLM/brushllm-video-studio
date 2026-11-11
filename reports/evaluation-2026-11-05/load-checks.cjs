const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root=path.resolve(__dirname,'../..');
const {probe,summarize}=require(path.join(root,'electron/engine/probe'));
const {resolveBinaries}=require(path.join(root,'electron/engine/binaries'));
const {JobManager}=require(path.join(root,'electron/engine/queue'));
const bins=resolveBinaries();
const input=path.join(root,'tests/media/out/sample.mp4');
(async()=>{
  await probe(bins.ffprobe,input);
  for(const concurrency of [4,40]){
    let next=0,active=0,peak=0;
    const t=performance.now();
    await Promise.all(Array.from({length:concurrency},async()=>{
      while(next<40){next++;active++;peak=Math.max(peak,active);try{await probe(bins.ffprobe,input);}finally{active--;}}
    }));
    console.log(JSON.stringify({check:'40 probe requests',concurrency,peak,wallMs:Math.round(performance.now()-t)}));
  }
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'brushvs-eval-compress-'));
  const manager=new JobManager(bins);
  const done=new Promise((resolve,reject)=>manager.on('updated',j=>{if(j.status==='done')resolve(j);if(j.status==='error')reject(new Error(j.error));}));
  const params={videoCodec:'h264',crf:23,encodeSpeed:'fast',audioBitrate:128,mode:'crf',qualityPreset:'balanced',hwStrategy:'auto'};
  await manager.add({op:'video.compress',params,requestedParams:params,gpuEncoders:['h264_videotoolbox','hevc_videotoolbox'],inputs:[input],outputPath:path.join(work,'compressed.mp4')});
  const job=await done;
  console.log(JSON.stringify({check:'default GPU compression on low bitrate input',inputBytes:fs.statSync(input).size,outputBytes:job.actual.size,ratio:job.actual.size/fs.statSync(input).size,videoBitrate:job.params.videoBitrate}));
  await manager.shutdown();fs.rmSync(work,{recursive:true,force:true});
})().catch(e=>{console.error(e);process.exitCode=1;});
