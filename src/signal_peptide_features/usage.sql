CREATE TABLE ux_sessions (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
--> statement-breakpoint
CREATE TABLE ux_events (id TEXT PRIMARY KEY, stream TEXT NOT NULL REFERENCES ux_sessions(id), session TEXT NOT NULL, seq INTEGER NOT NULL, received INTEGER NOT NULL, at INTEGER NOT NULL, ui TEXT NOT NULL, event TEXT NOT NULL, target TEXT NOT NULL, props TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX ux_events_received ON ux_events(received);
--> statement-breakpoint
CREATE INDEX ux_events_stream ON ux_events(stream,session,seq);
--> statement-breakpoint
CREATE TABLE ux_daily (day TEXT NOT NULL, ui TEXT NOT NULL, event TEXT NOT NULL, target TEXT NOT NULL, outcome TEXT NOT NULL, screen TEXT NOT NULL, modality TEXT NOT NULL, width TEXT NOT NULL, total INTEGER NOT NULL DEFAULT 0, duration_sum REAL NOT NULL DEFAULT 0, PRIMARY KEY(day,ui,event,target,outcome,screen,modality,width));
--> statement-breakpoint
CREATE TRIGGER ux_daily_insert AFTER INSERT ON ux_events BEGIN
 INSERT INTO ux_daily(day,ui,event,target,outcome,screen,modality,width,total,duration_sum)
 VALUES(date(NEW.received/1000,'unixepoch'),NEW.ui,NEW.event,NEW.target,coalesce(json_extract(NEW.props,'$.outcome'),'unknown'),coalesce(json_extract(NEW.props,'$.screen'),'unknown'),coalesce(json_extract(NEW.props,'$.modality'),'unknown'),coalesce(json_extract(NEW.props,'$.width'),'unknown'),1,coalesce(json_extract(NEW.props,'$.duration_ms'),0))
 ON CONFLICT(day,ui,event,target,outcome,screen,modality,width) DO UPDATE SET total=total+1,duration_sum=duration_sum+excluded.duration_sum;
END;
