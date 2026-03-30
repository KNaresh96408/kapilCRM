const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

exports.createSubfolder = functions.https.onRequest(async (req, res) => {
    const { kpiId, subfolderName } = req.body;

    if (!kpiId || !subfolderName) {
        return res.status(400).send('KPI-ID and subfolder name are required.');
    }

    const subfolderRef = admin.firestore().collection('attachments').doc(kpiId).collection('subfolders').doc(subfolderName);

    try {
        await subfolderRef.set({
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: req.user ? req.user.uid : 'system', // Assuming user info is attached to the request
        });

        return res.status(201).send(`Subfolder ${subfolderName} created successfully under KPI-ID ${kpiId}.`);
    } catch (error) {
        console.error('Error creating subfolder:', error);
        return res.status(500).send('Error creating subfolder.');
    }
});