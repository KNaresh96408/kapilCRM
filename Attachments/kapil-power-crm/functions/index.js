import { https } from 'firebase-functions';
import createKpiFolder from './attachments/createKpiFolder';
import listKpiFolders from './attachments/listKpiFolders';
import createSubfolder from './attachments/createSubfolder';
import saveFileMetadata from './attachments/saveFileMetadata';

export const api = {
  createKpiFolder: https.onRequest(createKpiFolder),
  listKpiFolders: https.onRequest(listKpiFolders),
  createSubfolder: https.onRequest(createSubfolder),
  saveFileMetadata: https.onRequest(saveFileMetadata),
};