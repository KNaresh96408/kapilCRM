const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

exports.createKpiFolder = functions.https.onRequest(async (req, res) => {
    const { kpiId, folderName } = req.body;

    if (!kpiId || !folderName) {
        return res.status(400).send('KPI-ID and folder name are required.');
    }

    const folderPath = `attachments/${kpiId}/${folderName}`;
    const folderRef = admin.firestore().collection('attachments').doc(kpiId);

    try {
        await folderRef.set({
            [folderName]: true
        }, { merge: true });

        return res.status(201).send(`Folder ${folderName} created successfully under KPI-ID ${kpiId}.`);
    } catch (error) {
        console.error('Error creating KPI folder:', error);
        return res.status(500).send('Error creating folder.');
    }
});