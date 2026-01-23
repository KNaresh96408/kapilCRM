package com.kapilpower.crm

import android.app.*
import android.content.Intent
import android.location.Location
import android.os.*
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions

class AttendanceForegroundService : Service() {

    private lateinit var fusedClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback

    private var uid: String = ""
    private var dateStr: String = ""

    override fun onCreate() {
        super.onCreate()

        fusedClient = LocationServices.getFusedLocationProviderClient(this)

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val loc: Location = result.lastLocation ?: return

                Log.d("ATTENDANCE_BG", "📍 Location: ${loc.latitude}, ${loc.longitude}")

                val data = hashMapOf(
                    "lat" to loc.latitude,
                    "lng" to loc.longitude,
                    "timestamp" to System.currentTimeMillis()
                )

                // ✅ SAFE WRITE (MERGE, AUTHENTICATED)
                FirebaseFirestore.getInstance()
                    .collection("attendance")
                    .document("${uid}_${dateStr}")
                    .set(
                        hashMapOf(
                            "userId" to uid,
                            "date" to dateStr,
                            "locations" to FieldValue.arrayUnion(data),
                            "updatedAt" to FieldValue.serverTimestamp()
                        ),
                        SetOptions.merge()
                    )
                    .addOnSuccessListener {
                        Log.d("ATTENDANCE_BG", "✅ Location saved to Firestore")
                    }
                    .addOnFailureListener { e ->
                        Log.e("ATTENDANCE_BG", "❌ Firestore write failed", e)
                    }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        uid = intent?.getStringExtra("uid") ?: ""
        dateStr = intent?.getStringExtra("dateStr") ?: ""

        // ✅ ENSURE FIREBASE AUTH EXISTS
        FirebaseAuth.getInstance().currentUser
            ?.getIdToken(true)
            ?.addOnSuccessListener {
                Log.d("ATTENDANCE_BG", "🔥 Firebase auth active")
            }
            ?.addOnFailureListener {
                Log.e("ATTENDANCE_BG", "❌ Firebase auth failed", it)
            }

        startForeground(101, createNotification())
        startLocationUpdates()

        return START_STICKY
    }

    private fun startLocationUpdates() {
        val request = LocationRequest.Builder(
            Priority.PRIORITY_BALANCED_POWER_ACCURACY,
            5 * 60 * 1000L
        )
            .setMinUpdateIntervalMillis(5 * 60 * 1000L)
            .build()

        fusedClient.requestLocationUpdates(
            request,
            locationCallback,
            Looper.getMainLooper()
        )
    }

    private fun createNotification(): Notification {
        val channelId = "attendance_tracking"

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "Attendance Tracking",
                NotificationManager.IMPORTANCE_LOW
            )
            getSystemService(NotificationManager::class.java)
                .createNotificationChannel(channel)
        }

        return NotificationCompat.Builder(this, channelId)
            .setContentTitle("Kapil Power CRM")
            .setContentText("Attendance tracking is active")
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setOngoing(true)
            .build()
    }

    override fun onDestroy() {
        fusedClient.removeLocationUpdates(locationCallback)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
