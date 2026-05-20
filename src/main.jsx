import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  AlertTriangle,
  Battery,
  BatteryCharging,
  Car,
  Circle,
  Clock3,
  Command,
  Cpu,
  Gauge,
  KeyRound,
  Layers,
  LocateFixed,
  Lock,
  LogOut,
  MapPinned,
  Navigation,
  Power,
  RefreshCw,
  Route,
  Search,
  Send,
  Settings,
  ShieldCheck,
  TimerReset,
  Unlock,
  Wifi,
  WifiOff,
  Zap
} from 'lucide-react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import './styles.css';

const API_TIMEOUT_MS = 18000;
const DEFAULT_CENTER = [-20.812249, -49.375975];
const DEFAULT_POLLING_MS = 30000;

const ICONS = {
  motorcycle: ['/vehicle-icons/cars2/motorcycle_base.png', '/vehicle-icons/cars/motorcycle_base.png', '/vehicle-icons/topview/motorcycle.png'],
  scooter: ['/vehicle-icons/cars2/scooter_base.png', '/vehicle-icons/cars/scooter_base.png', '/vehicle-icons/topview/motorcycle.png'],
  car: ['/vehicle-icons/cars2/carropasseio_base.png', '/vehicle-icons/cars/carroPasseio_base.png', '/vehicle-icons/topview/car.png'],
  utility: ['/vehicle-icons/cars2/carroutilitario_base.png', '/vehicle-icons/cars/carroUtilitario_base.png', '/vehicle-icons/topview/van.png'],
  truck: ['/vehicle-icons/cars2/truckbau_base.png', '/vehicle-icons/cars/truckBau_base.png', '/vehicle-icons/topview/truck.png'],
  truckHorse: ['/vehicle-icons/cars2/truckcavalo_base.png', '/vehicle-icons/cars/truckCavalo_base.png', '/vehicle-icons/topview/truck.png'],
  caminhao: ['/vehicle-icons/cars2/caminhaobau_base.png', '/vehicle-icons/cars/caminhaoBau_base.png', '/vehicle-icons/topview/truck.png'],
  bus: ['/vehicle-icons/cars2/bus_base.png', '/vehicle-icons/cars/bus_base.png', '/vehicle-icons/topview/bus.png'],
  van: ['/vehicle-icons/cars2/vanutilitario_base.png', '/vehicle-icons/cars/vanUtilitario_base.png', '/vehicle-icons/topview/van.png'],
  pickup: ['/vehicle-icons/topview/pickup.png', '/vehicle-icons/cars2/carroutilitario_base.png', '/vehicle-icons/cars/carroUtilitario_base.png'],
  tractor: ['/vehicle-icons/cars2/tractor_base.png', '/vehicle-icons/cars/tractor_base.png', '/vehicle-icons/topview/tractor.png'],
  bicycle: ['/vehicle-icons/cars2/bicycle_base.png', '/vehicle-icons/cars/bicycle_base.png', '/vehicle-icons/topview/default.png'],
  person: ['/vehicle-icons/cars2/person_base.png', '/vehicle-icons/cars/person_base.png', '/vehicle-icons/topview/default.png'],
  animal: ['/vehicle-icons/cars2/pet_base.png', '/vehicle-icons/cars/pet_base.png', '/vehicle-icons/topview/default.png'],
  boat: ['/vehicle-icons/cars2/boat_base.png', '/vehicle-icons/cars/boat_base.png', '/vehicle-icons/topview/default.png'],
  ship: ['/vehicle-icons/cars2/ship_base.png', '/vehicle-icons/cars/ship_base.png', '/vehicle-icons/topview/default.png'],
  airplane: ['/vehicle-icons/cars2/plane_base.png', '/vehicle-icons/cars/plane_base.png', '/vehicle-icons/topview/default.png'],
  helicopter: ['/vehicle-icons/cars2/helicopter_base.png', '/vehicle-icons/cars/helicopter_base.png', '/vehicle-icons/topview/default.png'],
  crane: ['/vehicle-icons/cars2/crane_base.png', '/vehicle-icons/cars/crane_base.png', '/vehicle-icons/topview/default.png'],
  offroad: ['/vehicle-icons/cars2/offroad_base.png', '/vehicle-icons/cars/offroad_base.png', '/vehicle-icons/topview/default.png'],
  default: ['/vehicle-icons/topview/default.png', '/vehicle-icons/cars2/default_base.png', '/vehicle-icons/cars/default_base.png']
};

const MAP_LAYERS = {
  osm: {
    label: 'OpenStreetMap',
    description: 'Mapa aberto de ruas',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap'
  },
  googleRoad: {
    label: 'Google Ruas',
    description: 'Google estradas',
    url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    attribution: '&copy; Google'
  },
  googleHybrid: {
    label: 'Google Híbrido',
    description: 'Satélite com ruas',
    url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    attribution: '&copy; Google'
  },
  googleSatellite: {
    label: 'Google Satélite',
    description: 'Satélite',
    url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    attribution: '&copy; Google'
  },
  esriSatellite: {
    label: 'Esri Satélite',
    description: 'Satélite alternativo',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri'
  },
  cartoDark: {
    label: 'Escuro',
    description: 'Operacional escuro',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO'
  }
};

const tabs = [
  ['dashboard', 'Dashboard', Activity],
  ['veiculos', 'Veículos', Car],
  ['eventos', 'Alertas', AlertTriangle],
  ['comandos', 'Comandos', Command],
  ['atributos', 'Atributos', Cpu],
  ['config', 'Config', Settings]
];

function normalizeText(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || API_TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; }
    catch { payload = { raw: text }; }
    if (!response.ok) {
      const error = new Error(payload?.error || payload?.message || payload?.raw || `HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Tempo esgotado ao conectar com o servidor.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('traccar-dev-theme') || 'dark');
  useEffect(() => {
    localStorage.setItem('traccar-dev-theme', theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return { theme, setTheme };
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function knotsToKmh(value) {
  const n = numberOrNull(value);
  return n === null ? 0 : n * 1.852;
}

function kmh(value) {
  return Math.round(knotsToKmh(value));
}

function formatSpeed(value) {
  return `${kmh(value)} km/h`;
}

function formatKmh(value) {
  return formatSpeed(value);
}

function formatDistance(value) {
  const n = numberOrNull(value);
  if (n === null) return '-';
  if (n >= 1000) return `${(n / 1000).toFixed(1)} km`;
  return `${Math.round(n)} m`;
}

function formatBattery(value) {
  const n = numberOrNull(value);
  if (n === null) return '-';
  return `${Math.round(n)}%`;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR');
}

function formatTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function timeAgo(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s atrás`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min atrás`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h atrás`;
  return `${Math.floor(hours / 24)}d atrás`;
}

function statusLabel(status) {
  const s = String(status || 'unknown').toLowerCase();
  if (s === 'online') return 'Online';
  if (s === 'offline') return 'Offline';
  return 'Indefinido';
}

function statusClass(status) {
  const s = String(status || 'unknown').toLowerCase();
  if (s === 'online') return 'good';
  if (s === 'offline') return 'bad';
  return 'warn';
}

function ignitionLabel(value) {
  if (value === true || value === 'true' || value === 1 || value === '1') return 'Ligada';
  if (value === false || value === 'false' || value === 0 || value === '0') return 'Desligada';
  return '-';
}

function yesNo(value) {
  if (value === true || value === 'true' || value === 1 || value === '1') return 'Sim';
  if (value === false || value === 'false' || value === 0 || value === '0') return 'Não';
  return '-';
}

function getPositionAttributes(position = {}) {
  return position?.attributes && typeof position.attributes === 'object' ? position.attributes : {};
}

function getDeviceAttributes(device = {}) {
  return device?.attributes && typeof device.attributes === 'object' ? device.attributes : {};
}

function getAttr(source = {}, names = [], fallback = undefined) {
  const direct = source && typeof source === 'object' ? source : {};
  const attrs = direct.attributes && typeof direct.attributes === 'object' ? direct.attributes : direct;
  for (const name of names) {
    if (attrs[name] !== undefined && attrs[name] !== null && attrs[name] !== '') return attrs[name];
  }
  return fallback;
}

function booleanValue(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const raw = normalizeText(value);
  if (['true', '1', 'yes', 'sim', 'on', 'ligado', 'ligada', 'active', 'ativo', 'ativa'].includes(raw)) return true;
  if (['false', '0', 'no', 'nao', 'não', 'off', 'desligado', 'desligada', 'inactive', 'inativo', 'inativa'].includes(raw)) return false;
  return null;
}

function telemetryAttr(device = {}, position = {}, names = [], fallback = null) {
  const pos = position && typeof position === 'object' ? position : {};
  const dev = device && typeof device === 'object' ? device : {};
  const posAttrs = getPositionAttributes(pos);
  const devAttrs = getDeviceAttributes(dev);

  for (const name of names) {
    if (pos[name] !== undefined && pos[name] !== null && pos[name] !== '') return pos[name];
    if (posAttrs[name] !== undefined && posAttrs[name] !== null && posAttrs[name] !== '') return posAttrs[name];
    if (dev[name] !== undefined && dev[name] !== null && dev[name] !== '') return dev[name];
    if (devAttrs[name] !== undefined && devAttrs[name] !== null && devAttrs[name] !== '') return devAttrs[name];
  }

  return fallback;
}

function isIgnitionOn(device = {}, position = {}) {
  return booleanValue(telemetryAttr(device, position, ['ignition', 'ignicao', 'ignição', 'engine', 'engineOn', 'acc', 'ACC', 'io239'], false)) === true;
}

function isBlocked(device = {}, position = {}) {
  return booleanValue(telemetryAttr(device, position, ['blocked', 'bloqueado', 'block', 'locked', 'lock', 'engineBlocked', 'fuelCut', 'relay', 'io240'], false)) === true;
}

function isMoving(device = {}, position = {}) {
  const motion = booleanValue(telemetryAttr(device, position, ['motion', 'moving', 'move'], null));
  if (motion === true) return true;
  const speed = kmh(position?.speed);
  return speed >= 3;
}

function lastPositionDate(position = {}) {
  const raw = position?.deviceTime || position?.fixTime || position?.serverTime || position?.time;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function minutesSincePosition(position = {}) {
  const date = lastPositionDate(position);
  if (!date) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
}

function movementState(device = {}, position = {}) {
  if (!position || typeof position !== 'object') return 'no-position';
  if (isMoving(device, position)) return 'moving';
  const idleMinutes = minutesSincePosition(position);
  if (isIgnitionOn(device, position) && idleMinutes !== null && idleMinutes >= 3) return 'idle';
  return 'stopped';
}

function movementLabel(state) {
  if (state === 'moving') return 'Em movimento';
  if (state === 'idle') return 'Ocioso';
  if (state === 'stopped') return 'Parado';
  return 'Sem posição';
}

function movementTone(state) {
  if (state === 'moving') return 'good';
  if (state === 'idle') return 'info';
  if (state === 'stopped') return 'bad';
  return 'warn';
}

function formatVoltage(value) {
  const n = numberOrNull(value);
  if (n === null) return '-';
  const volts = n > 1000 ? n / 1000 : n;
  return `${volts.toFixed(volts >= 10 ? 1 : 2)} V`;
}

function batteryPercent(device = {}, position = {}) {
  return telemetryAttr(device, position, ['batteryLevel', 'battery', 'batteryPercent', 'batteryPercentage', 'power'], null);
}

function vehicleVoltage(device = {}, position = {}) {
  return telemetryAttr(device, position, ['power', 'externalPower', 'voltage', 'vehicleVoltage', 'batteryVoltage', 'inputVoltage', 'io66', 'io67'], null);
}

function safeCourse(value) {
  const n = numberOrNull(value);
  if (n === null) return 0;
  return Math.round(((n % 360) + 360) % 360);
}

function getVehicleName(device = {}) {
  return String(device.name || device.uniqueId || `Veículo ${device.id || ''}`).trim();
}

function getVehiclePlate(device = {}) {
  const attrs = getDeviceAttributes(device);
  return String(attrs.plate || attrs.placa || attrs.licensePlate || attrs.registration || '').trim();
}

function getVehicleUniqueId(device = {}) {
  return String(device.uniqueId || device.uniqueid || device.identifier || '').trim();
}

function detectVehicleCategory(device = {}, position = {}) {
  const attrs = { ...getDeviceAttributes(device), ...getPositionAttributes(position) };
  const raw = normalizeText([
    device.category,
    attrs.category,
    attrs.vehicleType,
    attrs.tipo,
    attrs.type,
    attrs.model,
    device.name
  ].filter(Boolean).join(' '));

  if (/moto|motorcycle|motocicleta/.test(raw)) return 'motorcycle';
  if (/scooter/.test(raw)) return 'scooter';
  if (/cavalo|carreta|truckhorse|truck horse/.test(raw)) return 'truckHorse';
  if (/caminhao|caminhão|truck|bau|baú/.test(raw)) return 'truck';
  if (/onibus|ônibus|bus/.test(raw)) return 'bus';
  if (/van|utilitario|utilitário|furgao|furgão/.test(raw)) return 'van';
  if (/pickup|pick-up|hilux|s10|ranger|amarok|frontier/.test(raw)) return 'pickup';
  if (/trator|tractor/.test(raw)) return 'tractor';
  if (/bike|bicycle|bicicleta/.test(raw)) return 'bicycle';
  if (/pessoa|person|humano/.test(raw)) return 'person';
  if (/pet|animal|cachorro|gato/.test(raw)) return 'animal';
  if (/barco|boat/.test(raw)) return 'boat';
  if (/navio|ship/.test(raw)) return 'ship';
  if (/aviao|avião|plane|airplane/.test(raw)) return 'airplane';
  if (/helicoptero|helicóptero|helicopter/.test(raw)) return 'helicopter';
  if (/guindaste|crane/.test(raw)) return 'crane';
  if (/offroad|off-road|quadriciclo/.test(raw)) return 'offroad';
  if (/util/.test(raw)) return 'utility';
  return 'car';
}

function vehicleMapLabel(category) {
  const labels = {
    motorcycle: 'Moto', scooter: 'Scooter', car: 'Carro', utility: 'Utilitário',
    truck: 'Caminhão', truckHorse: 'Cavalo mecânico', caminhao: 'Caminhão', bus: 'Ônibus',
    van: 'Van', pickup: 'Pickup', tractor: 'Trator', bicycle: 'Bicicleta', person: 'Pessoa',
    animal: 'Pet', boat: 'Barco', ship: 'Navio', airplane: 'Avião', helicopter: 'Helicóptero',
    crane: 'Guindaste', offroad: 'Off-road', default: 'Veículo'
  };
  return labels[category] || labels.default;
}

function vehicleLabel(category) {
  return vehicleMapLabel(category);
}

function vehicleImage(categoryOrDevice, position = {}) {
  const category = typeof categoryOrDevice === 'string' ? categoryOrDevice : detectVehicleCategory(categoryOrDevice, position);
  return ICONS[category]?.[0] || ICONS.default[0];
}

function getVehicleImage(device = {}, position = {}) {
  return vehicleImage(detectVehicleCategory(device, position));
}

function hasVehicleImage(device = {}, position = {}) {
  return Boolean(getVehicleImage(device, position));
}

function getVehiclePhoto(device = {}, position = {}) {
  const attrs = getDeviceAttributes(device);
  return attrs.photo || attrs.image || attrs.icon || getVehicleImage(device, position);
}

function isValidPosition(position = {}) {
  if (!position || typeof position !== 'object') return false;

  const lat = numberOrNull(position.latitude);
  const lon = numberOrNull(position.longitude);

  if (lat === null || lon === null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;

  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function getLatLng(position = {}) {
  if (!isValidPosition(position)) return null;
  return [Number(position.latitude), Number(position.longitude)];
}

function getDevicePosition(device = {}, positions = []) {
  const positionId = numberOrNull(device.positionId);
  if (positionId !== null) {
    const byId = positions.find((position) => Number(position.id) === positionId);
    if (byId) return byId;
  }
  return positions.find((position) => Number(position.deviceId) === Number(device.id)) || null;
}

function eventTime(event = {}) {
  return event.eventTime || event.serverTime || event.deviceTime || event.fixTime || event.time || null;
}

function eventDeviceId(event = {}) {
  return Number(event.deviceId || event.deviceID || 0);
}

function alertText(event = {}, position = {}) {
  const attrs = event?.attributes && typeof event.attributes === 'object' ? event.attributes : {};
  const type = String(event?.type || getAttr(position, ['alarm', 'event'], '') || '').trim();
  const alarm = attrs.alarm || getAttr(position, ['alarm'], '');
  const map = {
    alarm: `Alarme${alarm ? `: ${alarm}` : ''}`,
    deviceOnline: 'Dispositivo online',
    deviceOffline: 'Dispositivo offline',
    deviceUnknown: 'Dispositivo sem comunicação',
    geofenceEnter: 'Entrada em cerca',
    geofenceExit: 'Saída de cerca',
    ignitionOn: 'Ignição ligada',
    ignitionOff: 'Ignição desligada',
    deviceMoving: 'Veículo em movimento',
    deviceStopped: 'Veículo parado',
    overspeed: 'Excesso de velocidade',
    commandResult: 'Resultado de comando',
    maintenance: 'Manutenção',
    textMessage: 'Mensagem'
  };
  return map[type] || (type ? type : 'Sem alerta');
}

function eventText(event = {}, position = {}) {
  return alertText(event, position);
}

function alertSeverity(event = {}) {
  const text = normalizeText(alertText(event));
  if (/offline|alarme|overspeed|velocidade|sos|panic|falha|violacao|violação/.test(text)) return 'bad';
  if (/unknown|sem comunicacao|sem comunicação|manutencao|manutenção/.test(text)) return 'warn';
  return 'good';
}

function alertClass(event = {}) {
  return alertSeverity(event);
}

function alertIcon(event = {}) {
  const severity = alertSeverity(event);
  if (severity === 'bad') return AlertTriangle;
  if (severity === 'warn') return ShieldCheck;
  return Activity;
}

function latestAlertForDevice(device = {}, events = []) {
  const did = Number(device.id);
  return normalizeArray(events)
    .filter((event) => eventDeviceId(event) === did)
    .sort((a, b) => new Date(eventTime(b) || 0) - new Date(eventTime(a) || 0))[0] || null;
}

function createVehicleIcon(device = {}, position = {}) {
  const safePosition = position && typeof position === 'object' ? position : {};
  const category = detectVehicleCategory(device, safePosition);
  const course = safeCourse(safePosition.course);
  const state = movementState(device, safePosition);
  const status = String(device.status || 'unknown').toLowerCase();
  const src = getVehiclePhoto(device, safePosition) || vehicleImage(category);
  const title = `${getVehicleName(device)} · ${movementLabel(state)} · ${formatSpeed(safePosition.speed)}`;

  return L.divIcon({
    className: '',
    iconSize: [64, 64],
    iconAnchor: [32, 32],
    popupAnchor: [0, -28],
    html: `
      <div class="vehicle-icon modern-vehicle-marker movement-${escapeHtml(state)} status-${escapeHtml(status)}" title="${escapeHtml(title)}">
        <div class="vehicle-icon-ring"></div>
        <img class="vehicle-icon-img" src="${escapeHtml(src)}" alt="${escapeHtml(vehicleMapLabel(category))}" style="transform: rotate(${course}deg)" />
        <span class="vehicle-icon-status"></span>
      </div>
    `
  });
}

function enrichDevices(devices, positions, events) {
  const validEvents = normalizeArray(events);
  return normalizeArray(devices).map((device) => {
    const position = getDevicePosition(device, positions);
    const event = latestAlertForDevice(device, validEvents);
    const category = detectVehicleCategory(device, position || {});
    return { device, position, event, category };
  });
}

function usePolling(callback, delayMs, enabled = true) {
  const callbackRef = useRef(callback);
  useEffect(() => { callbackRef.current = callback; }, [callback]);
  useEffect(() => {
    if (!enabled || !delayMs) return undefined;
    const timer = setInterval(() => callbackRef.current(), delayMs);
    return () => clearInterval(timer);
  }, [delayMs, enabled]);
}

function PopupMetric({ icon, label, value }) {
  return (
    <div className="popup-mini-line">
      {icon}
      <small><b>{label}:</b> {value}</small>
    </div>
  );
}

function TelemetryTile({ icon, label, value, tone = 'info' }) {
  return (
    <div className={`telemetry-tile ${tone}`}>
      <span className="telemetry-icon">{icon}</span>
      <span>
        <small>{label}</small>
        <b>{value ?? '-'}</b>
      </span>
    </div>
  );
}

function Speedometer({ speed }) {
  return (
    <div className="speedometer">
      <Gauge size={20} />
      <strong>{speed}</strong>
      <small>km/h</small>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="row">
      <small>{label}</small>
      <b>{value ?? '-'}</b>
    </div>
  );
}

function StatCard({ icon, label, value, hint }) {
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <small>{label}</small>
        {icon}
      </div>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function Badge({ tone = 'info', children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function MapAutoFit({ positions, enabled = true }) {
  const map = useMap();
  useEffect(() => {
    if (!enabled || !Array.isArray(positions) || positions.length === 0) return;
    const points = positions.map(getLatLng).filter(Boolean);
    if (!points.length) return;
    if (points.length === 1) {
      map.setView(points[0], 15, { animate: true });
      return;
    }
    map.fitBounds(points, { padding: [46, 46], maxZoom: 16 });
  }, [enabled, map, positions]);
  return null;
}

const VehicleMarker = memo(function VehicleMarker({ item }) {
  const { device, position, event, category } = item;
  const latLng = getLatLng(position);
  if (!latLng) return null;

  const attrs = getPositionAttributes(position);
  const state = movementState(device, position);
  const speed = kmh(position.speed);
  const blocked = isBlocked(device, position);
  const ignition = isIgnitionOn(device, position);
  const battery = batteryPercent(device, position);
  const voltage = vehicleVoltage(device, position);
  const last = position.deviceTime || position.fixTime || position.serverTime;
  const idleMinutes = minutesSincePosition(position);
  const plate = getVehiclePlate(device) || getVehicleUniqueId(device) || vehicleMapLabel(category);

  return (
    <Marker position={latLng} icon={createVehicleIcon(device, position)}>
      <Popup>
        <div className="vehicle-popup">
          <div className="vehicle-popup-header">
            <div>
              <b>{getVehicleName(device)}</b>
              <small>{plate}</small>
            </div>
            <Badge tone={movementTone(state)}>{movementLabel(state)}</Badge>
          </div>

          <div className="popup-speed-row">
            <Speedometer speed={speed} />
            <div className="popup-status-stack">
              <TelemetryTile icon={blocked ? <Lock size={15} /> : <Unlock size={15} />} label="Bloqueio" value={blocked ? 'Bloqueado' : 'Liberado'} tone={blocked ? 'bad' : 'good'} />
              <TelemetryTile icon={<KeyRound size={15} />} label="Ignição" value={ignition ? 'Ligada' : 'Desligada'} tone={ignition ? 'good' : 'bad'} />
            </div>
          </div>

          <div className="telemetry-grid">
            <TelemetryTile icon={<BatteryCharging size={15} />} label="Bateria" value={formatBattery(battery)} tone="info" />
            <TelemetryTile icon={<Zap size={15} />} label="Voltagem" value={formatVoltage(voltage)} tone="info" />
            <TelemetryTile icon={<Navigation size={15} />} label="Curso" value={`${safeCourse(position.course)}°`} tone="info" />
            <TelemetryTile icon={<Clock3 size={15} />} label="Atualização" value={timeAgo(last)} tone="warn" />
          </div>

          {state === 'idle' && (
            <div className="idle-alert">
              <TimerReset size={16} />
              Veículo ligado e parado há pelo menos {idleMinutes || 3} min.
            </div>
          )}

          <div className="popup-footer">
            <PopupMetric icon={<Power size={14} />} label="Status Traccar" value={statusLabel(device.status)} />
            <PopupMetric icon={<AlertTriangle size={14} />} label="Alerta" value={alertText(event, position)} />
            {attrs.sat || attrs.satellites ? <PopupMetric icon={<LocateFixed size={14} />} label="Satélites" value={attrs.sat || attrs.satellites} /> : null}
          </div>
        </div>
      </Popup>
    </Marker>
  );
});

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('[React ErrorBoundary]', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="error-box" style={{ margin: 20 }}>
          <b>Erro ao carregar o frontend.</b>
          <p>{this.state.error.message}</p>
          <button className="primary-btn" onClick={() => window.location.reload()}>Recarregar</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function Dashboard({ items, stats, layerKey, setLayerKey, fitMap, setFitMap, search, setSearch, statusFilter, setStatusFilter }) {
  const validPositions = items.map((item) => item?.position).filter(isValidPosition);
  const layer = MAP_LAYERS[layerKey] || MAP_LAYERS.osm;
  const moving = items.filter(({ device, position }) => movementState(device, position) === 'moving').length;
  const idle = items.filter(({ device, position }) => movementState(device, position) === 'idle').length;
  const stopped = items.filter(({ device, position }) => movementState(device, position) === 'stopped').length;

  return (
    <>
      <div className="card-grid modern-card-grid">
        <StatCard icon={<Car size={22} />} label="Veículos" value={stats.total} hint="Total carregado do Traccar" />
        <StatCard icon={<Navigation size={22} />} label="Movimento" value={moving} hint="Carro verde no mapa" />
        <StatCard icon={<TimerReset size={22} />} label="Ociosos" value={idle} hint="Ligado e parado +3 min" />
        <StatCard icon={<Power size={22} />} label="Parados" value={stopped} hint="Carro vermelho no mapa" />
      </div>

      <div className="layout map-dashboard-layout">
        <section className="panel map-stage-panel">
          <div className="map-toolbar">
            <div className="actions">
              <select value={layerKey} onChange={(event) => setLayerKey(event.target.value)} aria-label="Camada do mapa">
                {Object.entries(MAP_LAYERS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
              </select>
              <button className="ghost-btn" onClick={() => setFitMap((v) => !v)} title="Centralizar mapa">
                <MapPinned size={17} /> {fitMap ? 'Auto-fit ligado' : 'Auto-fit desligado'}
              </button>
            </div>
            <Badge tone="info"><Layers size={14} /> {layer.description}</Badge>
          </div>

          <div className="map-wrap full-background-map">
            <MapContainer center={getLatLng(validPositions[0]) || DEFAULT_CENTER} zoom={12} scrollWheelZoom>
              <TileLayer attribution={layer.attribution} url={layer.url} maxZoom={20} />
              <MapAutoFit positions={validPositions} enabled={fitMap} />
              {items.map((item) => <VehicleMarker key={item.device.id} item={item} />)}
            </MapContainer>
          </div>

          <section className="panel fleet-overlay-panel">
            <h3>Frota em tempo real</h3>
            <div className="actions fleet-search-actions">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                <Search size={16} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar veículo, placa ou ID" style={{ width: '100%' }} />
              </div>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">Todos</option>
                <option value="online">Online</option>
                <option value="offline">Offline</option>
                <option value="unknown">Indefinido</option>
              </select>
            </div>
            <div className="movement-legend">
              <span><i className="legend-dot moving"></i> Movimento</span>
              <span><i className="legend-dot stopped"></i> Parado</span>
              <span><i className="legend-dot idle"></i> Ocioso</span>
            </div>
            <VehicleList items={items} />
          </section>
        </section>
      </div>
    </>
  );
}

function VehicleList({ items, compact = false }) {
  if (!items.length) return <div className="warn-box">Nenhum veículo encontrado com os filtros atuais.</div>;
  return (
    <div className="list">
      {items.map(({ device, position, event, category }) => {
        const last = position?.deviceTime || position?.fixTime || position?.serverTime;
        return (
          <div className="row" key={device.id}>
            <div className="row-head">
              <div>
                <b>{getVehicleName(device)}</b>
                <br />
                <small>{vehicleLabel(category)} · {getVehiclePlate(device) || getVehicleUniqueId(device) || 'sem placa/ID'}</small>
              </div>
              <Badge tone={statusClass(device.status)}>{statusLabel(device.status)}</Badge>
            </div>
            <small>{position ? `${movementLabel(movementState(device, position))} · ${formatSpeed(position.speed)} · ${timeAgo(last)} · ${formatDate(last)}` : 'Sem posição recente'}</small>
            {!compact && <small>{alertText(event, position || {})}</small>}
          </div>
        );
      })}
    </div>
  );
}

function VehiclesPage({ items }) {
  return (
    <section className="panel">
      <h3>Veículos</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Status</th>
              <th>Tipo</th>
              <th>Velocidade</th>
              <th>Ignição</th>
              <th>Bateria</th>
              <th>Última posição</th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ device, position, category }) => {
              const attrs = getPositionAttributes(position || {});
              const last = position?.deviceTime || position?.fixTime || position?.serverTime;
              return (
                <tr key={device.id}>
                  <td><b>{getVehicleName(device)}</b><br /><small>{getVehiclePlate(device) || getVehicleUniqueId(device) || '-'}</small></td>
                  <td><Badge tone={statusClass(device.status)}>{statusLabel(device.status)}</Badge></td>
                  <td>{vehicleLabel(category)}</td>
                  <td>{position ? formatKmh(position.speed) : '-'}</td>
                  <td>{ignitionLabel(attrs.ignition)}</td>
                  <td>{formatBattery(getAttr(position || {}, ['batteryLevel', 'battery'], null))}</td>
                  <td>{formatDate(last)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EventsPage({ events, devicesById }) {
  const sorted = useMemo(() => normalizeArray(events).slice().sort((a, b) => new Date(eventTime(b) || 0) - new Date(eventTime(a) || 0)), [events]);
  if (!sorted.length) return <div className="warn-box">Nenhum alerta/evento retornado nas últimas 24 horas.</div>;
  return (
    <section className="panel">
      <h3>Alertas e eventos</h3>
      <div className="list" style={{ maxHeight: 'none' }}>
        {sorted.map((event, index) => {
          const Icon = alertIcon(event);
          const device = devicesById.get(eventDeviceId(event));
          return (
            <div className="row" key={`${event.id || eventTime(event) || index}-${index}`}>
              <div className="row-head">
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <Icon size={18} />
                  <b>{eventText(event)}</b>
                </div>
                <Badge tone={alertClass(event)}>{formatTime(eventTime(event))}</Badge>
              </div>
              <small>{device ? getVehicleName(device) : `Dispositivo ${eventDeviceId(event) || '-'}`} · {formatDate(eventTime(event))}</small>
              {event.attributes?.result && <small>Resultado: {String(event.attributes.result)}</small>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CommandsPage({ items }) {
  const [deviceId, setDeviceId] = useState('');
  const [types, setTypes] = useState([]);
  const [type, setType] = useState('');
  const [customData, setCustomData] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const selectedDeviceId = Number(deviceId || items[0]?.device?.id || 0);

  useEffect(() => {
    if (!selectedDeviceId) return;
    let cancelled = false;
    request(`/api/command-types?deviceId=${selectedDeviceId}`)
      .then((payload) => {
        if (cancelled) return;
        const list = normalizeArray(payload);
        setTypes(list);
        if (!type && list[0]?.type) setType(list[0].type);
      })
      .catch((error) => {
        if (!cancelled) setMessage(`Não foi possível carregar tipos de comando: ${error.message}`);
      });
    return () => { cancelled = true; };
  }, [selectedDeviceId, type]);

  const sendCommand = async () => {
    setBusy(true);
    setMessage('');
    try {
      const payload = {
        deviceId: selectedDeviceId,
        type: type || 'custom',
        attributes: customData ? { data: customData } : {}
      };
      const result = await request('/api/send-command', { method: 'POST', body: JSON.stringify(payload) });
      setMessage(result.ok ? 'Comando enviado ao Traccar.' : 'Comando enviado, mas o retorno não confirmou sucesso.');
    } catch (error) {
      setMessage(`Falha ao enviar comando: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h3>Comandos seguros</h3>
      <div className="warn-box">Comandos passam pelo proxy Node. Nenhuma credencial do Traccar fica exposta no navegador.</div>
      {message && <div className={message.startsWith('Falha') || message.startsWith('Não') ? 'error-box' : 'success-box'}>{message}</div>}
      <div className="form-grid">
        <label>
          <small>Veículo</small>
          <select value={deviceId || String(selectedDeviceId)} onChange={(event) => setDeviceId(event.target.value)} style={{ width: '100%', marginTop: 6 }}>
            {items.map(({ device }) => <option key={device.id} value={device.id}>{getVehicleName(device)}</option>)}
          </select>
        </label>
        <label>
          <small>Tipo de comando</small>
          <select value={type} onChange={(event) => setType(event.target.value)} style={{ width: '100%', marginTop: 6 }}>
            {types.map((item) => <option key={item.type || item} value={item.type || item}>{item.type || item}</option>)}
            <option value="custom">custom</option>
          </select>
        </label>
        <label className="full">
          <small>Dados personalizados opcional</small>
          <textarea value={customData} onChange={(event) => setCustomData(event.target.value)} placeholder="Exemplo: comando raw para rastreador quando o tipo for custom" />
        </label>
        <div className="full">
          <button className="primary-btn" onClick={sendCommand} disabled={busy || !selectedDeviceId}>
            <Send size={17} /> {busy ? 'Enviando...' : 'Enviar comando'}
          </button>
        </div>
      </div>
    </section>
  );
}

function AttributesPage({ items }) {
  const first = items[0] || {};
  const deviceAttrs = getDeviceAttributes(first.device || {});
  const positionAttrs = getPositionAttributes(first.position || {});
  return (
    <section className="panel">
      <h3>Atributos e sensores</h3>
      <div className="mini-grid" style={{ marginBottom: 12 }}>
        <Info label="GPS válido" value={yesNo(first.position?.valid)} />
        <Info label="Distância" value={formatDistance(positionAttrs.distance)} />
        <Info label="Total distance" value={formatDistance(positionAttrs.totalDistance)} />
        <Info label="Satélites" value={positionAttrs.sat || positionAttrs.satellites || '-'} />
      </div>
      <div className="layout">
        <div>
          <h3>Atributos do dispositivo</h3>
          <KeyValueTable data={deviceAttrs} />
        </div>
        <div>
          <h3>Atributos da posição</h3>
          <KeyValueTable data={positionAttrs} />
        </div>
      </div>
    </section>
  );
}

function KeyValueTable({ data }) {
  const entries = Object.entries(data || {}).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return <div className="warn-box">Sem atributos para exibir.</div>;
  return (
    <div className="table-wrap">
      <table>
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key}>
              <th>{key}</th>
              <td>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConfigPage({ config, health, refreshHealth, authUser, onLogout }) {
  return (
    <section className="panel">
      <h3>Configuração e segurança</h3>
      <div className="success-box">Frontend revisado com proxy seguro, rate limit, CSP, timeout, cache control e credenciais fora do React.</div>
      <div className="kv"><span>Servidor Traccar</span><b>{config?.traccarUrl || '-'}</b></div>
      <div className="kv"><span>Modo de autenticação</span><b>{config?.authMode || 'traccar-user-session'}</b></div>
      <div className="kv"><span>Usuário logado</span><b>{authUser?.name || authUser?.email || '-'}</b></div>
      <div className="kv"><span>Perfil admin</span><b>{yesNo(authUser?.administrator)}</b></div>
      <div className="kv"><span>Polling</span><b>{config?.pollingMs || DEFAULT_POLLING_MS} ms</b></div>
      <div className="kv"><span>Autenticado</span><b>{yesNo(config?.authenticated || health?.authenticated)}</b></div>
      <div className="kv"><span>Health</span><b>{health?.ok ? 'OK' : '-'}</b></div>
      <div className="actions" style={{ marginTop: 14 }}>
        <button className="ghost-btn" onClick={refreshHealth}><ShieldCheck size={17} /> Testar health</button>
        <button className="danger-btn" onClick={onLogout}><LogOut size={17} /> Sair</button>
      </div>
    </section>
  );
}

function applyFilters(items, search, statusFilter) {
  const term = normalizeText(search);
  return items.filter(({ device, position, category }) => {
    const status = String(device.status || 'unknown').toLowerCase();
    if (statusFilter !== 'all' && status !== statusFilter) return false;
    if (!term) return true;
    const text = normalizeText([
      getVehicleName(device), getVehiclePlate(device), getVehicleUniqueId(device), vehicleLabel(category), position?.address
    ].filter(Boolean).join(' '));
    return text.includes(term);
  });
}


function LoginPage({ onLogin }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const payload = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: login.trim(), password }) });
      onLogin(payload.user || null, payload.config || null);
    } catch (err) { setError(err.message || 'Falha ao entrar com as credenciais do Traccar.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="login-shell"><div className="login-card">
      <div className="login-brand"><div className="logo">RF</div><div><h1>RAFACAR DEV2</h1><p>Entre usando as credenciais do Traccar</p></div></div>
      <form onSubmit={submit} className="login-form">
        <label><small>Usuário ou e-mail Traccar</small><input value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" placeholder="usuario@empresa.com ou login" required /></label>
        <label><small>Senha Traccar</small><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="Digite sua senha" required /></label>
        {error && <div className="error-box"><b>Login não autorizado:</b> {error}</div>}
        <button className="primary-btn login-submit" disabled={busy} type="submit"><KeyRound size={18} /> {busy ? 'Validando no Traccar...' : 'Entrar no painel'}</button>
      </form>
      <div className="login-security"><ShieldCheck size={16} /><span>Sua senha é enviada somente ao backend local, que autentica no Traccar e guarda a sessão em cookie HttpOnly.</span></div>
    </div></div>
  );
}
function AuthLoading() {
  return <div className="login-shell"><div className="login-card compact"><div className="login-brand"><div className="logo">RF</div><div><h1>RAFACAR DEV2</h1><p>Verificando sessão segura...</p></div></div></div></div>;
}

function App() {
  const { theme, setTheme } = useTheme();
  const [auth, setAuth] = useState({ loading: true, authenticated: false, user: null });
  const [activeTab, setActiveTab] = useState('dashboard');
  const [devices, setDevices] = useState([]);
  const [positions, setPositions] = useState([]);
  const [events, setEvents] = useState([]);
  const [serverInfo, setServerInfo] = useState(null);
  const [config, setConfig] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [fitMap, setFitMap] = useState(true);
  const [layerKey, setLayerKey] = useState(() => localStorage.getItem('traccar-dev-map-layer') || 'googleHybrid');

  useEffect(() => { localStorage.setItem('traccar-dev-map-layer', layerKey); }, [layerKey]);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    setError('');
    if (!silent) setLoading(true);
    if (silent) setRefreshing(true);
    try {
      const payload = await request(silent ? '/api/snapshot' : '/api/bootstrap');
      setDevices(normalizeArray(payload.devices));
      setPositions(normalizeArray(payload.positions));
      setEvents(normalizeArray(payload.events));
      setServerInfo(payload.server || null);
      setConfig(payload.config || null);
      setLastUpdate(new Date());
      if (payload.errors?.length) setError(payload.errors.join(' | '));
    } catch (err) {
      if (err.status === 401) { setAuth({ loading: false, authenticated: false, user: null }); setError(''); return; }
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const payload = await request('/api/health');
      setHealth(payload);
    } catch (err) {
      setHealth({ ok: false, error: err.message });
    }
  }, []);

  const checkAuth = useCallback(async () => {
    try { const payload = await request('/api/auth/me'); setAuth({ loading: false, authenticated: true, user: payload.user || null }); setConfig(payload.config || null); }
    catch { setAuth({ loading: false, authenticated: false, user: null }); }
  }, []);
  const handleLogin = useCallback((user, nextConfig) => { setAuth({ loading: false, authenticated: true, user }); setConfig(nextConfig || null); setLoading(true); }, []);
  const handleLogout = useCallback(async () => {
    try { await request('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) }); } catch { /* ignore */ }
    setAuth({ loading: false, authenticated: false, user: null }); setDevices([]); setPositions([]); setEvents([]); setServerInfo(null); setHealth(null); setError(''); setLoading(false);
  }, []);
  useEffect(() => { checkAuth(); }, [checkAuth]);
  useEffect(() => { if (auth.authenticated) { loadData(); refreshHealth(); } }, [auth.authenticated, loadData, refreshHealth]);

  usePolling(() => loadData({ silent: true }), Number(config?.pollingMs || DEFAULT_POLLING_MS), auth.authenticated);

  const items = useMemo(() => enrichDevices(devices, positions, events), [devices, positions, events]);
  const filteredItems = useMemo(() => applyFilters(items, search, statusFilter), [items, search, statusFilter]);
  const devicesById = useMemo(() => new Map(devices.map((device) => [Number(device.id), device])), [devices]);

  const stats = useMemo(() => {
    const total = devices.length;
    const online = devices.filter((device) => String(device.status).toLowerCase() === 'online').length;
    const offline = devices.filter((device) => String(device.status).toLowerCase() === 'offline').length;
    const unknown = Math.max(0, total - online - offline);
    return { total, online, offline, unknown, events: events.length };
  }, [devices, events]);

  const title = tabs.find(([key]) => key === activeTab)?.[1] || 'Dashboard';
  const subtitle = serverInfo?.attributes?.title || serverInfo?.attributes?.description || 'Rastreamento em tempo real via Traccar';

  if (auth.loading) return <AuthLoading />;
  if (!auth.authenticated) return <LoginPage onLogin={handleLogin} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">RF</div>
          <div>
            <h1>RAFACAR DEV2</h1>
            <span>{auth.user?.name || auth.user?.email || 'Usuário Traccar'}</span>
          </div>
        </div>
        <nav className="nav">
          {tabs.map(([key, label, Icon]) => (
            <button key={key} className={activeTab === key ? 'active' : ''} onClick={() => setActiveTab(key)}>
              <Icon size={18} /> {label}
            </button>
          ))}
        </nav>
        <div style={{ marginTop: 18, display: 'grid', gap: 10 }}>
          <Badge tone={health?.ok ? 'good' : 'warn'}><ShieldCheck size={14} /> Proxy {health?.ok ? 'OK' : 'verificando'}</Badge>
          <Badge tone="info"><Activity size={14} /> {lastUpdate ? `Atualizado ${formatTime(lastUpdate)}` : 'Sem atualização'}</Badge>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <div className="actions">
            <button className="ghost-btn" onClick={() => setTheme(theme === 'dark' ? 'dark' : 'dark')} title="Tema fixado em modo escuro">
              <Settings size={17} /> Tema seguro
            </button>
            <button className="primary-btn" onClick={() => loadData({ silent: true })} disabled={refreshing}>
              <RefreshCw size={17} /> {refreshing ? 'Atualizando...' : 'Atualizar'}
            </button>
            <button className="danger-btn" onClick={handleLogout}><LogOut size={17} /> Sair</button>
          </div>
        </div>

        {loading && <div className="warn-box">Carregando dados do Traccar...</div>}
        {error && <div className="error-box"><b>Aviso:</b> {error}</div>}

        {activeTab === 'dashboard' && (
          <Dashboard
            items={filteredItems}
            stats={stats}
            layerKey={layerKey}
            setLayerKey={setLayerKey}
            fitMap={fitMap}
            setFitMap={setFitMap}
            search={search}
            setSearch={setSearch}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
          />
        )}
        {activeTab === 'veiculos' && <VehiclesPage items={filteredItems} />}
        {activeTab === 'eventos' && <EventsPage events={events} devicesById={devicesById} />}
        {activeTab === 'comandos' && <CommandsPage items={items} />}
        {activeTab === 'atributos' && <AttributesPage items={filteredItems} />}
        {activeTab === 'config' && <ConfigPage config={config} health={health} refreshHealth={refreshHealth} authUser={auth.user} onLogout={handleLogout} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
