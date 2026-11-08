package app.sportsballgo.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * Persistent foreground service: polls the official league APIs (NHL, MLB; ESPN is the backup) for the pinned teams, drivers and players and posts
 * a notification for scoring plays, starts and finals. Fast while something is live, slow when
 * idle, and backing off on errors (same rules as the app).
 */
public class WatcherService extends Service {
    static final String PREFS = "sportsball_watcher";
    private static final String CH_WATCH = "watching";
    private static final String CH_ALERT = "alerts";
    private static final int WATCH_ID = 1;
    private static final String HOST = "https://site.api.espn.com/apis/site/v2/sports/";

    private static final class Snap {
        String state = "pre";
        int away;
        int home;
    }

    private final Map<String, Snap> prev = new HashMap<>();
    private volatile boolean running = false;
    private Thread worker;
    private int nextAlertId = 2000;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createChannels();
        Notification n = watchingNotification("Starting…");
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(WATCH_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(WATCH_ID, n);
        }
        if (!running) {
            running = true;
            worker = new Thread(this::loop, "sportsball-watcher");
            worker.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (worker != null) worker.interrupt();
        super.onDestroy();
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private void loop() {
        int failures = 0;
        while (running) {
            long delay;
            try {
                if (!prefs().getBoolean("enabled", false)) {
                    stopSelf();
                    break;
                }
                JSONObject cfg = new JSONObject(prefs().getString("config", "{}"));
                boolean live = pollAll(cfg);
                failures = 0;
                delay = live ? 30000L : 60000L;
                updateWatching(cfg, live);
            } catch (Exception e) {
                failures++;
                delay = Math.min(300000L, 60000L << Math.min(failures - 1, 3));
            }
            try {
                Thread.sleep(delay);
            } catch (InterruptedException e) {
                break;
            }
        }
    }

    // ---- polling ----

    private boolean pollAll(JSONObject cfg) throws Exception {
        boolean live = false;

        // Teams, grouped by league so each scoreboard is fetched once.
        JSONArray teams = cfg.optJSONArray("teams");
        Map<String, Set<String>> codesByUrl = new HashMap<>();
        Map<String, String> leagueByUrl = new HashMap<>();
        if (teams != null) {
            for (int i = 0; i < teams.length(); i++) {
                JSONObject t = teams.getJSONObject(i);
                String url = HOST + t.getString("sport") + "/" + t.getString("league") + "/scoreboard"
                        + (t.optString("query").isEmpty() ? "" : "?" + t.getString("query"));
                if (!codesByUrl.containsKey(url)) codesByUrl.put(url, new HashSet<String>());
                codesByUrl.get(url).add(t.getString("code"));
                leagueByUrl.put(url, t.getString("league"));
            }
        }
        for (Map.Entry<String, Set<String>> entry : codesByUrl.entrySet()) {
            String league = leagueByUrl.get(entry.getKey());
            Boolean official = null;
            Long downUntil = officialDownUntil.get(league);
            if (downUntil == null || System.currentTimeMillis() >= downUntil) {
                try {
                    official = pollOfficial(league, entry.getValue());
                } catch (Exception e) {
                    // Official feed failed: back it off and use ESPN, the backup.
                    officialDownUntil.put(league, System.currentTimeMillis() + 300000L);
                }
            }
            live |= official != null ? official : pollTeams(entry.getKey(), league, entry.getValue());
        }

        live |= pollFields(cfg.optJSONArray("racing"), "racing", cfg.optJSONArray("drivers"), "Race");
        live |= pollFields(cfg.optJSONArray("golf"), "golf", cfg.optJSONArray("players"), "Tournament");
        return live;
    }

    private final Map<String, Long> officialDownUntil = new HashMap<>();

    /** Alerts for one game from a fresh snapshot (source-independent). */
    private void evaluate(String league, String id, String awayCode, String homeCode, Snap cur, String detail) {
        String key = "g:" + league + ":" + id;
        Snap p = prev.get(key);
        prev.put(key, cur);
        if (p == null) return; // first sighting is a baseline, not news

        String line = awayCode + " " + cur.away + " - " + cur.home + " " + homeCode;
        String tag = league.toUpperCase();
        if (!"post".equals(p.state) && "post".equals(cur.state)) {
            alert("🏁 Final · " + tag, line);
        } else if ("pre".equals(p.state) && "in".equals(cur.state)) {
            alert("▶ " + tag + ": game started", awayCode + " at " + homeCode);
        } else if (!"pre".equals(cur.state) && (cur.away != p.away || cur.home != p.home)) {
            String scorer = cur.away > p.away ? awayCode : cur.home > p.home ? homeCode : null;
            alert((scorer != null ? "★ " + scorer + " scores" : "Score update") + " · " + tag,
                    line + (detail.isEmpty() ? "" : " · " + detail));
        }
    }

    private static String mapCode(String league, String code) {
        if ("nhl".equals(league)) {
            switch (code) {
                case "LAK": return "LA";
                case "NJD": return "NJ";
                case "SJS": return "SJ";
                case "TBL": return "TB";
                case "UTA": return "UTAH";
                default: return code;
            }
        }
        if ("mlb".equals(league)) {
            switch (code) {
                case "AZ": return "ARI";
                case "CWS": return "CHW";
                default: return code;
            }
        }
        return code;
    }

    /**
     * Official league APIs (preferred): NHL web API and MLB Stats API. Returns whether anything
     * is live, or null when the league has no official feed here. Throws on failure so the
     * caller can fall back to ESPN.
     */
    private Boolean pollOfficial(String league, Set<String> codes) throws Exception {
        boolean live = false;
        if ("nhl".equals(league)) {
            JSONArray games = fetch("https://api-web.nhle.com/v1/score/now").optJSONArray("games");
            if (games == null) return false;
            for (int i = 0; i < games.length(); i++) {
                JSONObject g = games.getJSONObject(i);
                JSONObject at = g.getJSONObject("awayTeam");
                JSONObject ht = g.getJSONObject("homeTeam");
                String awayCode = mapCode(league, at.optString("abbrev"));
                String homeCode = mapCode(league, ht.optString("abbrev"));
                if (!codes.contains(awayCode) && !codes.contains(homeCode)) continue;
                String gs = g.optString("gameState");
                String state = ("LIVE".equals(gs) || "CRIT".equals(gs)) ? "in"
                        : ("OFF".equals(gs) || "FINAL".equals(gs)) ? "post" : "pre";
                if ("in".equals(state)) live = true;
                Snap cur = new Snap();
                cur.state = state;
                cur.away = at.optInt("score", 0);
                cur.home = ht.optInt("score", 0);
                JSONObject pd = g.optJSONObject("periodDescriptor");
                String detail = pd != null ? "P" + pd.optInt("number") : "";
                evaluate(league, String.valueOf(g.optLong("id")), awayCode, homeCode, cur, detail);
            }
            return live;
        }
        if ("mlb".equals(league)) {
            JSONArray dates = fetch("https://statsapi.mlb.com/api/v1/schedule?sportId=1&hydrate=linescore,team").optJSONArray("dates");
            if (dates == null) return false;
            for (int d = 0; d < dates.length(); d++) {
                JSONArray games = dates.getJSONObject(d).optJSONArray("games");
                if (games == null) continue;
                for (int i = 0; i < games.length(); i++) {
                    JSONObject g = games.getJSONObject(i);
                    JSONObject teams = g.getJSONObject("teams");
                    JSONObject at = teams.getJSONObject("away");
                    JSONObject ht = teams.getJSONObject("home");
                    String awayCode = mapCode(league, at.getJSONObject("team").optString("abbreviation"));
                    String homeCode = mapCode(league, ht.getJSONObject("team").optString("abbreviation"));
                    if (!codes.contains(awayCode) && !codes.contains(homeCode)) continue;
                    String abs = g.getJSONObject("status").optString("abstractGameState");
                    String state = "Live".equals(abs) ? "in" : "Final".equals(abs) ? "post" : "pre";
                    if ("in".equals(state)) live = true;
                    Snap cur = new Snap();
                    cur.state = state;
                    cur.away = at.optInt("score", 0);
                    cur.home = ht.optInt("score", 0);
                    JSONObject ls = g.optJSONObject("linescore");
                    String detail = ls != null
                            ? (ls.optString("inningState") + " " + ls.optString("currentInningOrdinal")).trim() : "";
                    evaluate(league, String.valueOf(g.optLong("gamePk")), awayCode, homeCode, cur, detail);
                }
            }
            return live;
        }
        return null;
    }

    private boolean pollTeams(String url, String league, Set<String> codes) throws Exception {
        boolean live = false;
        JSONArray events = fetch(url).optJSONArray("events");
        if (events == null) return false;
        for (int i = 0; i < events.length(); i++) {
            JSONObject evt = events.getJSONObject(i);
            JSONArray comps = evt.optJSONArray("competitions");
            if (comps == null || comps.length() == 0) continue;
            JSONArray competitors = comps.getJSONObject(0).optJSONArray("competitors");
            if (competitors == null) continue;

            JSONObject away = null;
            JSONObject home = null;
            for (int c = 0; c < competitors.length(); c++) {
                JSONObject comp = competitors.getJSONObject(c);
                if ("home".equals(comp.optString("homeAway"))) home = comp;
                else away = comp;
            }
            if (away == null || home == null) continue;
            String awayCode = away.optJSONObject("team") != null ? away.getJSONObject("team").optString("abbreviation") : "";
            String homeCode = home.optJSONObject("team") != null ? home.getJSONObject("team").optString("abbreviation") : "";
            if (!codes.contains(awayCode) && !codes.contains(homeCode)) continue;

            String state = stateOf(evt);
            if ("in".equals(state)) live = true;
            Snap cur = new Snap();
            cur.state = state;
            cur.away = toInt(away.optString("score"));
            cur.home = toInt(home.optString("score"));

            String detail = evt.optJSONObject("status") != null && evt.getJSONObject("status").optJSONObject("type") != null
                    ? evt.getJSONObject("status").getJSONObject("type").optString("detail") : "";
            evaluate(league, evt.optString("id"), awayCode, homeCode, cur, detail);
        }
        return live;
    }

    /** Races and tournaments: start and final only, listing the pinned names with positions. */
    private boolean pollFields(JSONArray slugs, String sport, JSONArray names, String noun) throws Exception {
        if (slugs == null || names == null || names.length() == 0) return false;
        Set<String> pinned = new HashSet<>();
        for (int i = 0; i < names.length(); i++) pinned.add(names.getString(i));
        boolean live = false;

        for (int s = 0; s < slugs.length(); s++) {
            JSONArray events = fetch(HOST + sport + "/" + slugs.getString(s) + "/scoreboard").optJSONArray("events");
            if (events == null) continue;
            for (int i = 0; i < events.length(); i++) {
                JSONObject evt = events.getJSONObject(i);
                JSONArray comps = evt.optJSONArray("competitions");
                if (comps == null || comps.length() == 0) continue;
                JSONObject session = comps.getJSONObject(comps.length() - 1); // the race is the last session
                JSONArray competitors = session.optJSONArray("competitors");
                if (competitors == null) continue;

                StringBuilder list = new StringBuilder();
                for (int c = 0; c < competitors.length(); c++) {
                    JSONObject comp = competitors.getJSONObject(c);
                    JSONObject athlete = comp.optJSONObject("athlete");
                    String name = athlete != null ? athlete.optString("displayName") : "";
                    if (!pinned.contains(name)) continue;
                    if (list.length() > 0) list.append(", ");
                    list.append("★ ").append(name);
                    int order = comp.optInt("order", 0);
                    if (order > 0) list.append(" P").append(order);
                }
                if (list.length() == 0) continue;

                String state = session.optJSONObject("status") != null
                        && session.getJSONObject("status").optJSONObject("type") != null
                        ? session.getJSONObject("status").getJSONObject("type").optString("state") : stateOf(evt);
                if ("in".equals(state)) live = true;
                Snap cur = new Snap();
                cur.state = state;
                String key = "f:" + sport + ":" + slugs.getString(s) + ":" + evt.optString("id");
                Snap p = prev.get(key);
                prev.put(key, cur);
                if (p == null) continue;
                String title = evt.optString("name");
                if (!"post".equals(p.state) && "post".equals(cur.state)) {
                    alert("🏁 Final · " + title, list.toString());
                } else if ("pre".equals(p.state) && "in".equals(cur.state)) {
                    alert("▶ " + noun + " underway · " + title, list.toString());
                }
            }
        }
        return live;
    }

    private static String stateOf(JSONObject evt) {
        JSONObject status = evt.optJSONObject("status");
        JSONObject type = status != null ? status.optJSONObject("type") : null;
        return type != null ? type.optString("state", "pre") : "pre";
    }

    private static int toInt(String s) {
        try {
            return Integer.parseInt(s.trim());
        } catch (Exception e) {
            return 0;
        }
    }

    private JSONObject fetch(String url) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(15000);
        conn.setRequestProperty("User-Agent", "SportsballGo/1.0");
        try {
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) throw new IOException("HTTP " + code);
            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                String line;
                while ((line = r.readLine()) != null) sb.append(line);
            }
            return new JSONObject(sb.toString());
        } finally {
            conn.disconnect();
        }
    }

    // ---- notifications ----

    private void createChannels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CH_WATCH, "Watching pinned teams", NotificationManager.IMPORTANCE_LOW));
        nm.createNotificationChannel(new NotificationChannel(CH_ALERT, "Pinned alerts", NotificationManager.IMPORTANCE_HIGH));
    }

    private PendingIntent openAppIntent() {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getActivity(this, 0, open, flags);
    }

    private Notification watchingNotification(String text) {
        return new NotificationCompat.Builder(this, CH_WATCH)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("Sportsball Go is watching your pins")
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(openAppIntent())
                .build();
    }

    private void updateWatching(JSONObject cfg, boolean live) {
        int pins = lenOf(cfg.optJSONArray("teams")) + lenOf(cfg.optJSONArray("drivers")) + lenOf(cfg.optJSONArray("players"));
        String text = pins + " pinned · " + (live ? "live now, checking every 30 s" : "nothing live, checking every minute");
        getSystemService(NotificationManager.class).notify(WATCH_ID, watchingNotification(text));
    }

    private static int lenOf(JSONArray a) {
        return a == null ? 0 : a.length();
    }

    private void alert(String title, String body) {
        Notification n = new NotificationCompat.Builder(this, CH_ALERT)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(openAppIntent())
                .build();
        getSystemService(NotificationManager.class).notify(nextAlertId++, n);
    }
}
