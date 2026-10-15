import {cp,mkdir} from 'node:fs/promises';await mkdir('build/server/migrations',{recursive:true});await cp('server/migrations','build/server/migrations',{recursive:true});
