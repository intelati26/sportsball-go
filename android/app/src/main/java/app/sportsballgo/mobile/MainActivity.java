package app.sportsballgo.mobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WatcherPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
