import functions from 'firebase-functions';
import admin from 'firebase-admin';

admin.initializeApp();

const db = admin.firestore();
const bucket = admin.storage().bucket();

export const uploadAttachment = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const { folderId, file } = req.body;

  if (!folderId || !file) {
    return res.status(400).send('Missing folderId or file');
  }

  try {
    const fileBuffer = Buffer.from(file, 'base64');
    const fileName = `${folderId}/${Date.now()}_${file.name}`;
    const fileUpload = bucket.file(fileName);

    await fileUpload.save(fileBuffer, {
      metadata: {
        contentType: file.type,
      },
    });

    const attachmentData = {
      folderId,
      fileName,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection('attachments').add(attachmentData);

    return res.status(200).send({ message: 'File uploaded successfully', fileName });
  } catch (error) {
    console.error('Error uploading file:', error);
    return res.status(500).send('Internal Server Error');
  }
});

export const getAttachments = functions.https.onRequest(async (req, res) => {
  const { folderId } = req.query;

  if (!folderId) {
    return res.status(400).send('Missing folderId');
  }

  try {
    const attachmentsSnapshot = await db.collection('attachments').where('folderId', '==', folderId).get();
    const attachments = attachmentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    return res.status(200).send(attachments);
  } catch (error) {
    console.error('Error fetching attachments:', error);
    return res.status(500).send('Internal Server Error');
  }
});