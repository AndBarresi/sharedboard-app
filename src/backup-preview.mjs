import {validateBrowserBackup} from './browser-validation.mjs';

export function createBackupPreviewReader({browserOnly=false,waitUntilSaved,getPlanningVersion,onChange}){
  let generation=0;
  return {
    async read(file){
      const current=++generation;
      onChange({preview:null,error:null,reading:Boolean(file)});
      if(!file)return;
      try{
        if(!browserOnly&&file.size>24_000_000)throw new Error('Choose a board backup smaller than 24 MB.');
        const text=await file.text();
        if(current!==generation)return;
        let backup;
        try{backup=validateBrowserBackup(JSON.parse(text));}
        catch(error){throw new Error(error.status?error.message:'Choose a valid .sharedboard board backup. Use Import drawing for .excalidraw files.');}
        const {expectedRevision}=await waitUntilSaved();
        if(current!==generation)return;
        onChange({preview:{backup,expectedRevision,expectedVersion:getPlanningVersion()},error:null,reading:false});
      }catch(error){if(current===generation)onChange({preview:null,error:error.message||'This backup could not be read. Your board has been preserved.',reading:false});}
    },
    cancel(){generation++;},
  };
}
