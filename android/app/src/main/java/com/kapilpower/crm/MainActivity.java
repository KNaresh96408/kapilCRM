package com.kapilpower.crm;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "MainActivity";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // ✅ DO NOT TOUCH BACK BUTTON
        // Capacitor will handle it
    }

    // -------------------------------
    // LOCATION SERVICES (unchanged)
    // -------------------------------
    public void startLocationService() {
        try {
            Intent i = new Intent(this, LocationService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(i);
            } else {
                startService(i);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error starting location service", e);
        }
    }

    public void stopLocationService() {
        try {
            Intent i = new Intent(this, LocationService.class);
            stopService(i);
        } catch (Exception e) {
            Log.e(TAG, "Error stopping location service", e);
        }
    }
}
