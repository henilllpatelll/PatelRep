# SFTPGo receiver for Opera Cloud scheduled-report delivery (see
# apps/api/services/opera/report_ingest.py). Runs as root because Railway's
# persistent volume mount is root-owned and SFTPGo's stock image drops to a
# non-root user, which cannot write to it -- staying root here lets the
# container write to the mounted volume so uploaded users/host-keys/report
# files survive restarts. This container has no other purpose and is not
# internet-reachable except via the pinned SFTP/WebAdmin credentials, so the
# reduced isolation from running as root is an accepted tradeoff.
FROM drakkan/sftpgo:v2.6.4
USER root
