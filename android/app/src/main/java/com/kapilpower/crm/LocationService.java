package com.kapilpower.crm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.*;

import org.json.JSONObject;

import java.util.Locale;

public class LocationService extends Service {
    private static final String TAG = "LocationService";
    public static final String CHANNEL_ID = "kapilpower_location_channel";
    private static final int NOTIF_ID = 4242;

    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;

    // Location request interval — 5 minutes (in ms)
    private static final long LOCATION_INTERVAL_MS = 5 * 60 * 1000L;
    private static final long FASTEST_INTERVAL_MS = 2 * 60 * 1000L;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        setupLocationCallback();
        Log.d(TAG, "Service created");
    }

    private void setupLocationCallback() {
        locationCallback = new LocationCallback(){
            @Override
            public void onLocationResult(@NonNull LocationResult result) {
                for (Location loc : result.getLocations()) {
                    handleNewLocation(loc);
                }
            }
        };
    }

    private void handleNewLocation(Location location) {
        if (location == null) return;
        double lat = location.getLatitude();
        double lng = location.getLongitude();
        float accuracy = location.getAccuracy();
        long ts = location.getTime();
        Log.d(TAG, "Got location: " + lat + "," + lng + " acc=" + accuracy);
        // TODO: Replace with your own upload to Firestore/Cloud Function
        sendLocationToServer(lat, lng, accuracy, ts);
    }

    // Placeholder — implement your own upload logic here
    private void sendLocationToServer(double lat, double lng, float accuracy, long ts) {
        // Example: call your REST endpoint / Cloud Function / direct Firestore write
        // For now just log
        Log.d(TAG, String.format(Locale.US, "sendLocationToServer: %f, %f (%f) @%d", lat, lng, accuracy, ts));
        // Example: use OkHttp or Firebase Admin SDK (not included here)
    }

    private LocationRequest createLocationRequest() {
        LocationRequest lr = LocationRequest.create();
        lr.setInterval(LOCATION_INTERVAL_MS);
        lr.setFastestInterval(FASTEST_INTERVAL_MS);
        lr.setPriority(Priority.PRIORITY_HIGH_ACCURACY);
        return lr;
    }

    private void startLocationUpdates() {
        try {
            LocationRequest request = createLocationRequest();
            fusedLocationClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper());
            Log.d(TAG, "Location updates started");
        } catch (SecurityException se) {
            Log.e(TAG, "Missing location permission", se);
        }
    }

    private void stopLocationUpdates() {
        try {
            if (fusedLocationClient != null && locationCallback != null) {
                fusedLocationClient.removeLocationUpdates(locationCallback);
            }
            Log.d(TAG, "Location updates stopped");
        } catch (Exception e) {
            Log.w(TAG, "Error stopping location updates", e);
        }
    }

    private Notification buildForegroundNotification() {
        Intent i = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Kapil Power CRM — tracking active")
                .setContentText("Location tracking is running")
                .setSmallIcon(R.mipmap.ic_launcher)// use your app icon
                .setContentIntent(pi)
                .setOngoing(true)
                .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            CharSequence name = "KapilPower Location";
            String description = "Background location channel";
            int importance = NotificationManager.IMPORTANCE_LOW;
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, name, importance);
            channel.setDescription(description);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "onStartCommand");
        Notification notif = buildForegroundNotification();
        startForeground(NOTIF_ID, notif);
        startLocationUpdates();
        // If killed by system, do not recreate until explicit start
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        stopLocationUpdates();
        Log.d(TAG, "Service destroyed");
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null; // not binding
    }
}
