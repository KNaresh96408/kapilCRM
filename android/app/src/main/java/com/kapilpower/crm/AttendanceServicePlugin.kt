package com.kapilpower.crm

import android.Manifest
import android.content.Intent
import com.getcapacitor.*

@CapacitorPlugin(
    name = "AttendanceService",
    permissions = [
        Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION]),
        Permission(strings = [Manifest.permission.ACCESS_COARSE_LOCATION])
    ]
)
class AttendanceServicePlugin : Plugin() {

    @PluginMethod
    fun startTracking(call: PluginCall) {

        if (!hasRequiredPermissions()) {
            call.reject("Location permission not granted")
            return
        }

        val uid = call.getString("uid")
        val dateStr = call.getString("dateStr")

        if (uid == null || dateStr == null) {
            call.reject("uid or dateStr missing")
            return
        }

        val intent = Intent(context, AttendanceForegroundService::class.java)
        intent.putExtra("uid", uid)
        intent.putExtra("dateStr", dateStr)

        context.startForegroundService(intent)
        call.resolve()
    }

    @PluginMethod
    fun stopTracking(call: PluginCall) {
        val intent = Intent(context, AttendanceForegroundService::class.java)
        context.stopService(intent)
        call.resolve()
    }

    private fun hasRequiredPermissions(): Boolean {
        return activity?.let {
            PermissionHelper.hasPermission(it, Manifest.permission.ACCESS_FINE_LOCATION)
        } ?: false
    }
}
