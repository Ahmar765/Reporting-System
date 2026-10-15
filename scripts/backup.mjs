import 'dotenv/config';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdir,chmod,copyFile} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
const dir=resolve(process.env.BACKUP_DIR||'./data/backups');
await mkdir(dir,{recursive:true,mode:0o700});
const stamp=new Date().toISOString().replaceAll(':','-')+'-'+randomUUID();
const target=join(dir,'reporting-'+stamp+'.sqlite');
const attachments=join(dir,'reporting-'+stamp+'-attachments');
const db=new DatabaseSync(process.env.DATABASE_PATH||'./data/reporting.sqlite',{readOnly:true});
try{await backup(db,target);await chmod(target,0o600);const files=db.prepare('SELECT storage_name FROM report_files').all();if(files.length){await mkdir(attachments,{recursive:true,mode:0o700});for(const f of files){const copy=join(attachments,basename(f.storage_name));await copyFile(resolve('./data/uploads',f.storage_name),copy);await chmod(copy,0o600);}}console.log('Database backup created:',target,'; attachment files:',files.length?attachments:'none');}finally{db.close();}
