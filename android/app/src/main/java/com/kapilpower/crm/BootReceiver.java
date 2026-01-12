package com.kapilpower.crm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "BootReceiver";
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;
        if (action.equalsIgnoreCase("android.intent.action.BOOT_COMPLETED") ||
            action.equalsIgnoreCase("android.intent.action.QUICKBOOT_POWERON")) {
            Log.d(TAG, "Boot completed - starting LocationService");
            Intent svc = new Intent(context, LocationService.class);
            // use startForegroundService on Oreo+
            try {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    context.startForegroundService(svc);
                } else {
                    context.startService(svc);
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to start service on boot", e);
            }
        }
    }
}
