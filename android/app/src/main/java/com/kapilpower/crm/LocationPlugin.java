package com.kapilpower.crm;

import android.content.Intent;
import android.os.Build;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "LocationNative")
public class LocationPlugin extends Plugin {

  public void start(PluginCall call) {
    Intent i = new Intent(getContext(), LocationService.class);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      getContext().startForegroundService(i);
    } else {
      getContext().startService(i);
    }
    call.resolve();
  }

  public void stop(PluginCall call) {
    Intent i = new Intent(getContext(), LocationService.class);
    getContext().stopService(i);
    call.resolve();
  }
}
