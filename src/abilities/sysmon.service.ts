/**
 * System Monitoring Service
 * Provides 31 tools for monitoring system resources, Docker, services, and logs
 */
import * as si from 'systeminformation';
import Docker from 'dockerode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

// Docker client singleton
let dockerClient: Docker | null = null;

function getDockerClient(): Docker {
  if (!dockerClient) {
    dockerClient = new Docker({ socketPath: '/var/run/docker.sock' });
  }
  return dockerClient;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function humanBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let unitIndex = 0;
  let value = bytes;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function humanDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// ============================================================================
// SYSTEM TOOLS (9)
// ============================================================================

/**
 * Get current CPU usage percentage
 */
export async function systemCpuUsage(perCpu: boolean = false): Promise<object> {
  const load = await si.currentLoad();

  return {
    usage_percent: perCpu ? load.cpus.map(c => c.load) : [load.currentLoad],
    core_count: load.cpus.length,
    per_cpu: perCpu,
    timestamp: new Date().toISOString()
  };
}

/**
 * Get CPU model, cores, and frequency information
 */
export async function systemCpuInfo(): Promise<object> {
  const cpu = await si.cpu();

  return {
    model: cpu.brand,
    vendor: cpu.manufacturer,
    physical_cores: cpu.physicalCores,
    logical_cores: cpu.cores,
    frequency_mhz: cpu.speed * 1000,
    cache_size_kb: cpu.cache?.l3 || 0
  };
}

/**
 * Get memory and swap usage statistics
 */
export async function systemMemory(): Promise<object> {
  const mem = await si.mem();

  return {
    total_bytes: mem.total,
    used_bytes: mem.used,
    available_bytes: mem.available,
    used_percent: (mem.used / mem.total) * 100,
    swap_total_bytes: mem.swaptotal,
    swap_used_bytes: mem.swapused,
    swap_percent: mem.swaptotal > 0 ? (mem.swapused / mem.swaptotal) * 100 : 0,
    total_human: humanBytes(mem.total),
    used_human: humanBytes(mem.used),
    available_human: humanBytes(mem.available)
  };
}

/**
 * Get disk usage for mount points
 */
export async function systemDiskUsage(diskPath: string = '/', all: boolean = false): Promise<object> {
  const disks = await si.fsSize();

  let partitions = disks;
  if (!all) {
    partitions = disks.filter(d => d.mount === diskPath);
    if (partitions.length === 0) {
      partitions = disks.filter(d => d.mount === '/');
    }
  }

  return {
    partitions: partitions.map(d => ({
      mount_point: d.mount,
      device: d.fs,
      fstype: d.type,
      total_bytes: d.size,
      used_bytes: d.used,
      free_bytes: d.available,
      used_percent: d.use,
      total_human: humanBytes(d.size),
      used_human: humanBytes(d.used),
      free_human: humanBytes(d.available)
    }))
  };
}

/**
 * Get disk I/O statistics
 */
export async function systemDiskIo(): Promise<object> {
  const io = await si.disksIO();
  const disks = await si.blockDevices();

  return {
    disks: disks.map(d => ({
      name: d.name,
      read_bytes: io.rIO || 0,
      write_bytes: io.wIO || 0,
      read_human: humanBytes(io.rIO || 0),
      write_human: humanBytes(io.wIO || 0)
    }))
  };
}

/**
 * Get system uptime and boot time
 */
export async function systemUptime(): Promise<object> {
  const time = await si.time();
  const uptime = time.uptime;
  const bootTime = new Date(Date.now() - uptime * 1000);

  return {
    uptime_seconds: uptime,
    uptime_human: humanDuration(uptime),
    boot_time: bootTime.toISOString()
  };
}

/**
 * Get system load averages (1, 5, 15 minutes)
 */
export async function systemLoad(): Promise<object> {
  const load = await si.currentLoad();
  const loadAvg = await si.fullLoad();

  // Get load averages from /proc/loadavg on Linux
  try {
    const loadavg = await fs.readFile('/proc/loadavg', 'utf-8');
    const [load1, load5, load15] = loadavg.split(' ').map(parseFloat);
    return { load1, load5, load15 };
  } catch {
    return {
      load1: load.currentLoad,
      load5: loadAvg,
      load15: loadAvg
    };
  }
}

/**
 * Get CPU and other sensor temperatures
 */
export async function systemTemperatures(): Promise<object> {
  try {
    const temps = await si.cpuTemperature();

    const sensors: Array<{
      sensor_key: string;
      temperature_celsius: number;
      high_threshold?: number | null;
      critical_threshold?: number | null;
    }> = [];

    if (temps.main !== null) {
      sensors.push({
        sensor_key: 'cpu_main',
        temperature_celsius: temps.main,
        high_threshold: temps.max || null,
        critical_threshold: temps.max ? temps.max + 10 : null
      });
    }

    if (temps.cores && temps.cores.length > 0) {
      temps.cores.forEach((temp, i) => {
        if (temp !== null) {
          sensors.push({
            sensor_key: `cpu_core_${i}`,
            temperature_celsius: temp
          });
        }
      });
    }

    return { sensors };
  } catch {
    return { sensors: [] };
  }
}

/**
 * Get OS, kernel version, hostname, and architecture info
 */
export async function systemInfo(): Promise<object> {
  const os = await si.osInfo();

  return {
    hostname: os.hostname,
    os: os.platform,
    platform: os.distro,
    platform_family: os.platform,
    platform_version: os.release,
    kernel_version: os.kernel,
    kernel_arch: os.arch
  };
}

// ============================================================================
// NETWORK TOOLS (3)
// ============================================================================

/**
 * List network interfaces with IP and MAC addresses
 */
export async function networkInterfaces(): Promise<object> {
  const interfaces = await si.networkInterfaces();

  return {
    interfaces: (Array.isArray(interfaces) ? interfaces : [interfaces]).map(iface => ({
      name: iface.iface,
      hardware_addr: iface.mac,
      addresses: [iface.ip4, iface.ip6].filter(Boolean),
      mtu: iface.mtu || 0,
      flags: [
        iface.operstate === 'up' ? 'up' : 'down',
        iface.type
      ].filter(Boolean)
    }))
  };
}

/**
 * Get bandwidth statistics (bytes/packets sent/received)
 */
export async function networkBandwidth(interfaceName?: string): Promise<object> {
  const stats = await si.networkStats(interfaceName);

  return {
    interfaces: (Array.isArray(stats) ? stats : [stats]).map(s => ({
      name: s.iface,
      bytes_sent: s.tx_bytes,
      bytes_recv: s.rx_bytes,
      errors_in: s.rx_errors,
      errors_out: s.tx_errors,
      drop_in: s.rx_dropped,
      drop_out: s.tx_dropped,
      sent_human: humanBytes(s.tx_bytes),
      recv_human: humanBytes(s.rx_bytes)
    }))
  };
}

/**
 * List active network connections
 */
export async function networkConnections(kind: string = 'all'): Promise<object> {
  const connections = await si.networkConnections();

  let filtered = connections;
  if (kind !== 'all') {
    filtered = connections.filter(c => c.protocol.toLowerCase().includes(kind.toLowerCase()));
  }

  return {
    connections: filtered.map(c => ({
      type: c.protocol,
      local_addr: c.localAddress,
      local_port: c.localPort ? parseInt(c.localPort) : 0,
      remote_addr: c.peerAddress,
      remote_port: c.peerPort ? parseInt(c.peerPort) : 0,
      status: c.state,
      pid: c.pid
    })),
    count: filtered.length
  };
}

// ============================================================================
// PROCESS TOOLS (3)
// ============================================================================

/**
 * List running processes
 */
export async function processList(limit: number = 50, sortBy: string = 'cpu'): Promise<object> {
  const processes = await si.processes();

  let sorted = [...processes.list];
  switch (sortBy) {
    case 'memory':
    case 'mem':
      sorted.sort((a, b) => b.memRss - a.memRss);
      break;
    case 'pid':
      sorted.sort((a, b) => a.pid - b.pid);
      break;
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    default: // cpu
      sorted.sort((a, b) => b.cpu - a.cpu);
  }

  return {
    processes: sorted.slice(0, limit).map(p => ({
      pid: p.pid,
      name: p.name,
      username: p.user,
      cpu_percent: p.cpu,
      memory_percent: p.mem,
      memory_rss_bytes: p.memRss,
      status: p.state,
      create_time: p.started
    })),
    count: Math.min(limit, sorted.length)
  };
}

/**
 * Get detailed information about a specific process
 */
export async function processInfo(pid: number): Promise<object> {
  const processes = await si.processes();
  const proc = processes.list.find(p => p.pid === pid);

  if (!proc) {
    throw new Error(`Process ${pid} not found`);
  }

  return {
    pid: proc.pid,
    name: proc.name,
    username: proc.user,
    cpu_percent: proc.cpu,
    memory_percent: proc.mem,
    memory_rss_bytes: proc.memRss,
    memory_vms_bytes: proc.memVsz,
    status: proc.state,
    create_time: proc.started,
    cmdline: proc.command,
    ppid: proc.parentPid,
    nice: proc.nice,
    path: proc.path
  };
}

/**
 * Get top N processes by CPU or memory usage
 */
export async function processTop(n: number = 10, by: string = 'cpu'): Promise<object> {
  const result = await processList(n, by);
  return {
    ...result,
    sorted_by: by
  };
}

// ============================================================================
// DOCKER TOOLS (7)
// ============================================================================

/**
 * List Docker containers
 */
export async function dockerContainers(all: boolean = false): Promise<object> {
  try {
    const docker = getDockerClient();
    const containers = await docker.listContainers({ all });

    return {
      containers: containers.map(c => ({
        id: c.Id.substring(0, 12),
        name: c.Names[0]?.replace(/^\//, '') || '',
        image: c.Image,
        status: c.Status,
        state: c.State,
        created: c.Created,
        ports: c.Ports.map(p =>
          p.PublicPort
            ? `${p.PublicPort}:${p.PrivatePort}/${p.Type}`
            : `${p.PrivatePort}/${p.Type}`
        ),
        labels: c.Labels
      })),
      count: containers.length
    };
  } catch (error: any) {
    throw new Error(`Docker not available: ${error.message}`);
  }
}

/**
 * Get container resource usage statistics
 */
export async function dockerContainerStats(containerIdOrName: string): Promise<object> {
  try {
    const docker = getDockerClient();
    const container = docker.getContainer(containerIdOrName);
    const stats = await container.stats({ stream: false });

    // Calculate CPU percentage
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100 : 0;

    // Calculate memory percentage
    const memUsage = stats.memory_stats.usage || 0;
    const memLimit = stats.memory_stats.limit || 1;
    const memPercent = (memUsage / memLimit) * 100;

    // Calculate network I/O
    let netRx = 0, netTx = 0;
    if (stats.networks) {
      Object.values(stats.networks).forEach((net: any) => {
        netRx += net.rx_bytes || 0;
        netTx += net.tx_bytes || 0;
      });
    }

    return {
      id: containerIdOrName,
      cpu_percent: cpuPercent,
      memory_usage_bytes: memUsage,
      memory_limit_bytes: memLimit,
      memory_percent: memPercent,
      network_rx_bytes: netRx,
      network_tx_bytes: netTx,
      memory_human: humanBytes(memUsage),
      network_rx_human: humanBytes(netRx),
      network_tx_human: humanBytes(netTx)
    };
  } catch (error: any) {
    throw new Error(`Failed to get container stats: ${error.message}`);
  }
}

/**
 * Get container logs
 */
export async function dockerContainerLogs(
  containerIdOrName: string,
  tail: number = 100,
  since?: string
): Promise<object> {
  try {
    const docker = getDockerClient();
    const container = docker.getContainer(containerIdOrName);

    const options: any = {
      stdout: true,
      stderr: true,
      tail,
      timestamps: true
    };
    if (since) {
      options.since = Math.floor(new Date(since).getTime() / 1000);
    }

    const logs = await container.logs(options) as unknown as Buffer;
    const logLines = logs.toString('utf8').split('\n').filter(Boolean);

    return {
      container: containerIdOrName,
      logs: logLines,
      lines: logLines.length
    };
  } catch (error: any) {
    throw new Error(`Failed to get container logs: ${error.message}`);
  }
}

/**
 * Get detailed container configuration
 */
export async function dockerContainerInspect(containerIdOrName: string): Promise<object> {
  try {
    const docker = getDockerClient();
    const container = docker.getContainer(containerIdOrName);
    const inspect = await container.inspect();

    return {
      id: inspect.Id.substring(0, 12),
      name: inspect.Name.replace(/^\//, ''),
      image: inspect.Image,
      created: inspect.Created,
      state: {
        status: inspect.State.Status,
        running: inspect.State.Running,
        paused: inspect.State.Paused,
        restarting: inspect.State.Restarting,
        started_at: inspect.State.StartedAt,
        finished_at: inspect.State.FinishedAt,
        exit_code: inspect.State.ExitCode
      },
      config: {
        hostname: inspect.Config.Hostname,
        env: inspect.Config.Env,
        cmd: inspect.Config.Cmd,
        working_dir: inspect.Config.WorkingDir,
        labels: inspect.Config.Labels
      },
      mounts: inspect.Mounts.map(m => ({
        type: m.Type,
        source: m.Source,
        destination: m.Destination,
        mode: m.Mode,
        rw: m.RW
      }))
    };
  } catch (error: any) {
    throw new Error(`Failed to inspect container: ${error.message}`);
  }
}

/**
 * List Docker networks
 */
export async function dockerNetworks(): Promise<object> {
  try {
    const docker = getDockerClient();
    const networks = await docker.listNetworks();

    return {
      networks: networks.map(n => ({
        id: n.Id.substring(0, 12),
        name: n.Name,
        driver: n.Driver,
        scope: n.Scope,
        subnet: n.IPAM?.Config?.[0]?.Subnet || null,
        gateway: n.IPAM?.Config?.[0]?.Gateway || null
      })),
      count: networks.length
    };
  } catch (error: any) {
    throw new Error(`Failed to list networks: ${error.message}`);
  }
}

/**
 * List Docker volumes
 */
export async function dockerVolumes(): Promise<object> {
  try {
    const docker = getDockerClient();
    const volumes = await docker.listVolumes();

    return {
      volumes: (volumes.Volumes || []).map(v => ({
        name: v.Name,
        driver: v.Driver,
        mountpoint: v.Mountpoint,
        labels: v.Labels,
        scope: v.Scope,
        created_at: (v as any).CreatedAt || null
      })),
      count: volumes.Volumes?.length || 0
    };
  } catch (error: any) {
    throw new Error(`Failed to list volumes: ${error.message}`);
  }
}

/**
 * List Docker images
 */
export async function dockerImages(): Promise<object> {
  try {
    const docker = getDockerClient();
    const images = await docker.listImages();

    return {
      images: images.map(img => ({
        id: img.Id.substring(7, 19),
        tags: img.RepoTags || [],
        size_bytes: img.Size,
        created: img.Created,
        size_human: humanBytes(img.Size)
      })),
      count: images.length
    };
  } catch (error: any) {
    throw new Error(`Failed to list images: ${error.message}`);
  }
}

// ============================================================================
// SERVICE TOOLS (3)
// ============================================================================

// Allowlist of services that can be restarted
const ALLOWED_RESTART_SERVICES = new Set([
  'nginx', 'apache2', 'httpd', 'docker', 'containerd',
  'postgresql', 'mysql', 'mariadb', 'redis', 'redis-server',
  'memcached', 'mongodb', 'mongod', 'elasticsearch',
  'rabbitmq-server', 'php-fpm', 'php7.4-fpm', 'php8.0-fpm',
  'php8.1-fpm', 'php8.2-fpm', 'php8.3-fpm',
  'gunicorn', 'uwsgi', 'supervisor', 'cron', 'crond'
]);

/**
 * Get status of a systemd service
 */
export async function serviceStatus(serviceName: string): Promise<object> {
  const name = serviceName.endsWith('.service') ? serviceName : `${serviceName}.service`;

  try {
    const { stdout } = await execAsync(`systemctl show ${name} --no-pager -p Id,Description,LoadState,ActiveState,SubState,MainPID,MemoryCurrent`);

    const props: Record<string, string> = {};
    stdout.split('\n').forEach(line => {
      const [key, value] = line.split('=');
      if (key && value !== undefined) {
        props[key] = value;
      }
    });

    return {
      name,
      description: props.Description || '',
      load_state: props.LoadState || '',
      active_state: props.ActiveState || '',
      sub_state: props.SubState || '',
      main_pid: parseInt(props.MainPID) || 0,
      memory_current_bytes: props.MemoryCurrent !== '[not set]' ? parseInt(props.MemoryCurrent) : 0
    };
  } catch (error: any) {
    throw new Error(`Failed to get service status: ${error.message}`);
  }
}

/**
 * List systemd services
 */
export async function serviceList(state?: string): Promise<object> {
  try {
    const { stdout } = await execAsync('systemctl list-units --type=service --no-pager --no-legend');

    const services = stdout.split('\n')
      .filter(line => line.trim())
      .map(line => {
        const parts = line.trim().split(/\s+/);
        return {
          name: parts[0],
          load_state: parts[1],
          active_state: parts[2],
          sub_state: parts[3],
          description: parts.slice(4).join(' ')
        };
      });

    let filtered = services;
    if (state) {
      switch (state) {
        case 'active':
          filtered = services.filter(s => s.active_state === 'active');
          break;
        case 'inactive':
          filtered = services.filter(s => s.active_state === 'inactive');
          break;
        case 'failed':
          filtered = services.filter(s => s.active_state === 'failed');
          break;
        case 'running':
          filtered = services.filter(s => s.sub_state === 'running');
          break;
      }
    }

    return {
      services: filtered,
      count: filtered.length
    };
  } catch (error: any) {
    throw new Error(`Failed to list services: ${error.message}`);
  }
}

/**
 * Restart a systemd service (ACTION - only allowed services)
 */
export async function serviceRestart(serviceName: string): Promise<object> {
  const baseName = serviceName.replace('.service', '');
  const name = `${baseName}.service`;

  if (!ALLOWED_RESTART_SERVICES.has(baseName)) {
    throw new Error(`Service "${serviceName}" is not in the allowed restart list. Only explicitly allowed services can be restarted.`);
  }

  try {
    await execAsync(`systemctl restart ${name}`);

    return {
      service: name,
      status: 'done',
      message: `Service ${name} restart completed`
    };
  } catch (error: any) {
    throw new Error(`Failed to restart service: ${error.message}`);
  }
}

// ============================================================================
// LOG TOOLS (3)
// ============================================================================

/**
 * Read journalctl system logs
 */
export async function logsJournal(
  unit?: string,
  lines: number = 50,
  since?: string,
  priority?: number
): Promise<object> {
  const args = ['journalctl', '--no-pager', '-n', lines.toString()];

  if (unit) args.push('-u', unit);
  if (since) args.push('--since', since);
  if (priority !== undefined && priority >= 0 && priority <= 7) {
    args.push('-p', priority.toString());
  }

  try {
    const { stdout } = await execAsync(args.join(' '));
    const logLines = stdout.split('\n').filter(Boolean);

    return {
      lines: logLines,
      count: logLines.length,
      unit: unit || null,
      since: since || null
    };
  } catch (error: any) {
    throw new Error(`Failed to read journal: ${error.message}`);
  }
}

/**
 * Read a log file from /var/log/
 */
export async function logsFile(
  filePath: string,
  lines: number = 100,
  tail: boolean = true
): Promise<object> {
  const absPath = path.resolve(filePath);

  // Security check: only /var/log
  if (!absPath.startsWith('/var/log/')) {
    throw new Error('Only log files in /var/log/ can be read for security reasons');
  }

  try {
    const content = await fs.readFile(absPath, 'utf-8');
    const allLines = content.split('\n').filter(Boolean);

    const result = tail
      ? allLines.slice(-lines)
      : allLines.slice(0, lines);

    return {
      path: absPath,
      lines: result,
      count: result.length,
      from_tail: tail
    };
  } catch (error: any) {
    throw new Error(`Failed to read log file: ${error.message}`);
  }
}

// Allowed log paths for clearing
const ALLOWED_LOG_PATTERNS = [
  '/var/log/nginx/',
  '/var/log/apache2/',
  '/var/log/httpd/',
  '/var/log/php',
  '/var/log/mysql/',
  '/var/log/postgresql/',
  '/var/log/redis/',
  '/var/log/mongodb/',
  '/var/log/app/',
  '/var/log/application/'
];

const FORBIDDEN_LOG_PATHS = [
  '/var/log/syslog',
  '/var/log/messages',
  '/var/log/auth.log',
  '/var/log/secure',
  '/var/log/kern.log',
  '/var/log/dmesg',
  '/var/log/boot.log',
  '/var/log/cron',
  '/var/log/apt/',
  '/var/log/dpkg.log',
  '/var/log/audit/',
  '/var/log/journal/'
];

/**
 * Clear/truncate a log file (ACTION - only allowed paths)
 */
export async function logsClear(filePath: string): Promise<object> {
  const absPath = path.resolve(filePath);

  // Check forbidden first
  for (const forbidden of FORBIDDEN_LOG_PATHS) {
    if (absPath.startsWith(forbidden) || absPath === forbidden.replace(/\/$/, '')) {
      throw new Error(`Cannot clear system log: ${absPath}`);
    }
  }

  // Check allowed
  const isAllowed = ALLOWED_LOG_PATTERNS.some(pattern => absPath.startsWith(pattern));
  if (!isAllowed) {
    throw new Error(`Path "${absPath}" is not in the allowed list for clearing. Only application logs can be cleared.`);
  }

  try {
    await fs.truncate(absPath, 0);

    return {
      path: absPath,
      status: 'success',
      message: `Log file ${absPath} has been cleared`
    };
  } catch (error: any) {
    throw new Error(`Failed to clear log file: ${error.message}`);
  }
}

// ============================================================================
// MAINTENANCE TOOLS (3)
// ============================================================================

/**
 * Show disk space usage (df -h equivalent)
 */
export async function maintenanceDf(): Promise<object> {
  return systemDiskUsage('/', true);
}

/**
 * Check for available package updates
 */
export async function maintenanceAptCheck(): Promise<object> {
  try {
    // Try apt-get (Debian/Ubuntu)
    const { stdout } = await execAsync('apt-get -s upgrade 2>/dev/null || yum check-update -q 2>/dev/null || echo ""');

    const lines = stdout.split('\n');
    let count = 0;
    let securityCount = 0;

    for (const line of lines) {
      if (line.startsWith('Inst ')) {
        count++;
        if (line.includes('-security')) {
          securityCount++;
        }
      }
    }

    const message = count > 0
      ? `${count} packages can be upgraded (${securityCount} security updates)`
      : 'No updates available';

    return {
      count,
      security_count: securityCount,
      message
    };
  } catch {
    return {
      count: 0,
      security_count: 0,
      message: 'No package manager available or no updates found'
    };
  }
}

// Protected temp file patterns
const PROTECTED_TEMP_PATTERNS = [
  '.X11-unix',
  '.ICE-unix',
  '.font-unix',
  '.XIM-unix',
  'systemd-private-',
  'snap.',
  'docker',
  'containerd'
];

/**
 * Clean old temporary files (ACTION)
 */
export async function maintenanceCleanupTemp(olderThanDays: number = 7): Promise<object> {
  const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
  const tempDirs = ['/tmp', '/var/tmp'];

  let filesRemoved = 0;
  let bytesFreed = 0;
  const errors: string[] = [];

  for (const dir of tempDirs) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Check protected patterns
        const isProtected = PROTECTED_TEMP_PATTERNS.some(p => entry.name.includes(p));
        if (isProtected) continue;

        try {
          const stats = await fs.stat(fullPath);

          if (stats.mtimeMs > cutoffTime) continue;

          if (entry.isDirectory()) {
            // Only remove empty directories
            const contents = await fs.readdir(fullPath);
            if (contents.length === 0) {
              await fs.rmdir(fullPath);
              filesRemoved++;
            }
          } else {
            bytesFreed += stats.size;
            await fs.unlink(fullPath);
            filesRemoved++;
          }
        } catch (e: any) {
          errors.push(`${fullPath}: ${e.message}`);
        }
      }
    } catch (e: any) {
      errors.push(`${dir}: ${e.message}`);
    }
  }

  return {
    files_removed: filesRemoved,
    bytes_freed: bytesFreed,
    bytes_freed_human: humanBytes(bytesFreed),
    older_than_days: olderThanDays,
    status: errors.length > 0 ? 'partial' : 'success',
    errors: errors.length > 0 ? errors : undefined
  };
}

// ============================================================================
// TOOL DEFINITIONS FOR LLM
// ============================================================================

export const sysmonTools = [
  // System Tools
  {
    type: 'function' as const,
    function: {
      name: 'system_cpu_usage',
      description: 'Get current CPU usage percentage',
      parameters: {
        type: 'object',
        properties: {
          per_cpu: { type: 'boolean', description: 'Return per-CPU usage instead of aggregate' }
        }
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'system_cpu_info',
      description: 'Get CPU model, cores, and frequency information',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'system_memory',
      description: 'Get memory and swap usage statistics',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'system_disk_usage',
      description: 'Get disk usage for mount points',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Mount point path (default: /)' },
          all: { type: 'boolean', description: 'Show all mount points' }
        }
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'system_disk_io',
      description: 'Get disk I/O statistics',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'system_uptime',
      description: 'Get system uptime and boot time',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'system_load',
      description: 'Get system load averages (1, 5, 15 minutes)',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'system_temperatures',
      description: 'Get CPU and other sensor temperatures',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'system_info',
      description: 'Get OS, kernel version, hostname, and architecture info',
      parameters: { type: 'object', properties: {} }
    }
  },
  // Network Tools
  {
    type: 'function' as const,
    function: {
      name: 'network_interfaces',
      description: 'List network interfaces with IP and MAC addresses',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'network_bandwidth',
      description: 'Get bandwidth statistics (bytes/packets sent/received)',
      parameters: {
        type: 'object',
        properties: {
          interface: { type: 'string', description: 'Specific interface name (optional)' }
        }
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'network_connections',
      description: 'List active network connections',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'Connection type: tcp, udp, all (default: all)' }
        }
      }
    }
  },
  // Process Tools
  {
    type: 'function' as const,
    function: {
      name: 'process_list',
      description: 'List running processes',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum processes to return (default: 50)' },
          sort_by: { type: 'string', description: 'Sort by: cpu, memory, pid, name (default: cpu)' }
        }
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'process_info',
      description: 'Get detailed information about a specific process',
      parameters: {
        type: 'object',
        properties: {
          pid: { type: 'number', description: 'Process ID' }
        },
        required: ['pid']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'process_top',
      description: 'Get top N processes by CPU or memory usage',
      parameters: {
        type: 'object',
        properties: {
          n: { type: 'number', description: 'Number of processes (default: 10)' },
          by: { type: 'string', description: 'Sort by: cpu or memory (default: cpu)' }
        }
      }
    }
  },
  // Docker Tools
  {
    type: 'function' as const,
    function: {
      name: 'docker_containers',
      description: 'List Docker containers',
      parameters: {
        type: 'object',
        properties: {
          all: { type: 'boolean', description: 'Include stopped containers' }
        }
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'docker_container_stats',
      description: 'Get container resource usage statistics',
      parameters: {
        type: 'object',
        properties: {
          container: { type: 'string', description: 'Container ID or name' }
        },
        required: ['container']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'docker_container_logs',
      description: 'Get container logs',
      parameters: {
        type: 'object',
        properties: {
          container: { type: 'string', description: 'Container ID or name' },
          tail: { type: 'number', description: 'Lines from end (default: 100)' },
          since: { type: 'string', description: 'Show logs since timestamp' }
        },
        required: ['container']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'docker_container_inspect',
      description: 'Get detailed container configuration',
      parameters: {
        type: 'object',
        properties: {
          container: { type: 'string', description: 'Container ID or name' }
        },
        required: ['container']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'docker_networks',
      description: 'List Docker networks',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'docker_volumes',
      description: 'List Docker volumes',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'docker_images',
      description: 'List Docker images',
      parameters: { type: 'object', properties: {} }
    }
  },
  // Service Tools
  {
    type: 'function' as const,
    function: {
      name: 'service_status',
      description: 'Get status of a systemd service',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'Service name (e.g., nginx)' }
        },
        required: ['service']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'service_list',
      description: 'List systemd services',
      parameters: {
        type: 'object',
        properties: {
          state: { type: 'string', description: 'Filter: active, inactive, failed, running' }
        }
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'service_restart',
      description: '[ACTION] Restart a systemd service (only allowed services)',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'Service name' }
        },
        required: ['service']
      }
    }
  },
  // Log Tools
  {
    type: 'function' as const,
    function: {
      name: 'logs_journal',
      description: 'Read journalctl system logs',
      parameters: {
        type: 'object',
        properties: {
          unit: { type: 'string', description: 'Filter by systemd unit' },
          lines: { type: 'number', description: 'Lines to return (default: 50)' },
          since: { type: 'string', description: 'Show logs since (e.g., "1 hour ago")' },
          priority: { type: 'number', description: 'Priority 0-7 (0=emerg, 7=debug)' }
        }
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'logs_file',
      description: 'Read a log file from /var/log/',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to log file' },
          lines: { type: 'number', description: 'Lines to return (default: 100)' },
          tail: { type: 'boolean', description: 'Read from end (default: true)' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'logs_clear',
      description: '[ACTION] Clear/truncate a log file (only allowed paths)',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to log file' }
        },
        required: ['path']
      }
    }
  },
  // Maintenance Tools
  {
    type: 'function' as const,
    function: {
      name: 'maintenance_df',
      description: 'Show disk space usage (df -h equivalent)',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'maintenance_apt_check',
      description: 'Check for available package updates',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'maintenance_cleanup_temp',
      description: '[ACTION] Clean old temporary files from /tmp and /var/tmp',
      parameters: {
        type: 'object',
        properties: {
          older_than_days: { type: 'number', description: 'Remove files older than N days (default: 7)' }
        }
      }
    }
  }
];

/**
 * Execute a sysmon tool by name
 */
export async function executeSysmonTool(name: string, args: Record<string, any> = {}): Promise<object> {
  switch (name) {
    // System
    case 'system_cpu_usage': return systemCpuUsage(args.per_cpu);
    case 'system_cpu_info': return systemCpuInfo();
    case 'system_memory': return systemMemory();
    case 'system_disk_usage': return systemDiskUsage(args.path, args.all);
    case 'system_disk_io': return systemDiskIo();
    case 'system_uptime': return systemUptime();
    case 'system_load': return systemLoad();
    case 'system_temperatures': return systemTemperatures();
    case 'system_info': return systemInfo();
    // Network
    case 'network_interfaces': return networkInterfaces();
    case 'network_bandwidth': return networkBandwidth(args.interface);
    case 'network_connections': return networkConnections(args.kind);
    // Process
    case 'process_list': return processList(args.limit, args.sort_by);
    case 'process_info': return processInfo(args.pid);
    case 'process_top': return processTop(args.n, args.by);
    // Docker
    case 'docker_containers': return dockerContainers(args.all);
    case 'docker_container_stats': return dockerContainerStats(args.container);
    case 'docker_container_logs': return dockerContainerLogs(args.container, args.tail, args.since);
    case 'docker_container_inspect': return dockerContainerInspect(args.container);
    case 'docker_networks': return dockerNetworks();
    case 'docker_volumes': return dockerVolumes();
    case 'docker_images': return dockerImages();
    // Services
    case 'service_status': return serviceStatus(args.service);
    case 'service_list': return serviceList(args.state);
    case 'service_restart': return serviceRestart(args.service);
    // Logs
    case 'logs_journal': return logsJournal(args.unit, args.lines, args.since, args.priority);
    case 'logs_file': return logsFile(args.path, args.lines, args.tail);
    case 'logs_clear': return logsClear(args.path);
    // Maintenance
    case 'maintenance_df': return maintenanceDf();
    case 'maintenance_apt_check': return maintenanceAptCheck();
    case 'maintenance_cleanup_temp': return maintenanceCleanupTemp(args.older_than_days);

    default:
      throw new Error(`Unknown sysmon tool: ${name}`);
  }
}
