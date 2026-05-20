#!/bin/bash

# Morning Quests Backup Script
# Runs via CRON on Vultr host

export PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

APP_DIR="/home/mphinance/kilian_morning"
BACKUP_DIR="/home/mphinance/kilian_morning_backups"
DATE=$(date +%Y-%m-%d)
STATE_FILE="$APP_DIR/data/state_default.json"
BACKUP_FILE="$BACKUP_DIR/state_$DATE.json.bak"

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

# Copy the file
if [ -f "$STATE_FILE" ]; then
    cp "$STATE_FILE" "$BACKUP_FILE"
    echo "Backed up $STATE_FILE to $BACKUP_FILE"
else
    echo "Warning: State file not found at $STATE_FILE. Kilian hasn't played yet?"
    exit 0
fi

# Clean up backups older than 30 days
find "$BACKUP_DIR" -type f -name "*.bak" -mtime +30 -exec rm {} \;
echo "Cleanup complete."
