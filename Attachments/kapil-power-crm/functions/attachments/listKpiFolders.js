const admin = require('firebase-admin');
const functions = require('firebase-functions');

admin.initializeApp();

exports.listKpiFolders = functions.https.onRequest(async (req, res) => {
    try {
        const kpiFoldersSnapshot = await admin.firestore().collection('kpiFolders').get();
        const kpiFolders = [];

        kpiFoldersSnapshot.forEach(doc => {
            kpiFolders.push({ id: doc.id, ...doc.data() });
        });

        res.status(200).json(kpiFolders);
    } catch (error) {
        console.error('Error fetching KPI folders:', error);
        res.status(500).send('Internal Server Error');
    }
});