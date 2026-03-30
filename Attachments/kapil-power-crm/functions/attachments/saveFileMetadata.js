const admin = require('firebase-admin');
const functions = require('firebase-functions');

// Initialize Firebase Admin SDK
admin.initializeApp();

exports.saveFileMetadata = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    const { kpiId, folderName, fileName, createdBy, createdAt } = req.body;

    if (!kpiId || !folderName || !fileName || !createdBy) {
        return res.status(400).send('Missing required fields');
    }

    try {
        const fileMetadata = {
            kpiId,
            folderName,
            fileName,
            createdBy,
            createdAt: createdAt || admin.firestore.FieldValue.serverTimestamp(),
        };

        const docRef = admin.firestore().collection('attachments').doc(kpiId).collection(folderName).doc(fileName);
        await docRef.set(fileMetadata);

        return res.status(200).send('File metadata saved successfully');
    } catch (error) {
        console.error('Error saving file metadata:', error);
        return res.status(500).send('Internal Server Error');
    }
});