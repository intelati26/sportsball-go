package app.sportsballgo.mobile;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;

/**
 * Bridge between the web app and the background watcher.
 * Favorites and the watch config live in SharedPreferences, which Android Auto Backup
 * (android:allowBackup) restores after a reinstall.
 */
@CapacitorPlugin(name = "Watcher")
public class WatcherPlugin extends Plugin {

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(WatcherService.PREFS, Context.MODE_PRIVATE);
    }

    /** save({ favorites?: string[], config?: object }) */
    @PluginMethod
    public void save(PluginCall call) {
        SharedPreferences.Editor e = prefs().edit();
        JSArray favorites = call.getArray("favorites");
        if (favorites != null) e.putString("favorites", favorites.toString());
        if (call.getObject("config") != null) e.putString("config", call.getObject("config").toString());
        e.apply();
        call.resolve();
    }

    /** setEnabled({ enabled: boolean }) starts or stops the persistent watcher service. */
    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        prefs().edit().putBoolean("enabled", on).apply();
        Context ctx = getContext();
        Intent intent = new Intent(ctx, WatcherService.class);
        if (on) {
            askForNotificationPermission();
            ContextCompat.startForegroundService(ctx, intent);
        } else {
            ctx.stopService(intent);
        }
        call.resolve();
    }

    /** getState() -> { enabled, favorites } */
    @PluginMethod
    public void getState(PluginCall call) {
        JSObject result = new JSObject();
        result.put("enabled", prefs().getBoolean("enabled", false));
        JSONArray favorites;
        try {
            favorites = new JSONArray(prefs().getString("favorites", "[]"));
        } catch (JSONException ex) {
            favorites = new JSONArray();
        }
        result.put("favorites", favorites);
        call.resolve(result);
    }

    private void askForNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && getActivity() != null
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    getActivity(), new String[] {Manifest.permission.POST_NOTIFICATIONS}, 4711);
        }
    }
}
