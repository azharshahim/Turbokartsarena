/** Dedicated garage page. Reuses the live showroom canvas and V3 economy. */
import { VEHICLES, vehicleProfile } from '../src/game/vehicles';
import { ROSTER } from '../src/game/roster';
import { buyVehicle, buyUpgrade, UPGRADE_KINDS, upgradeCost, upgradedProfile, type GarageState } from '../src/game/economy';
const labels = ['Moteur', 'Accélération', 'Vitesse maximale', 'Freinage', 'Adhérence', 'Protection', 'Turbo'];
export function mountGarage(options: {
  garage: () => GarageState; selected: () => number; select: (index: number) => void;
  persist: () => void; refresh: () => void; reduceMotion: (value: boolean) => void;
}) {
  const page = document.createElement('section');
  page.id = 'turboGarage'; page.hidden = true;
  page.setAttribute('aria-label', 'Garage Turbo Karts');
  page.innerHTML = `<header><div><small>COLLECTION · ATELIER · PERFORMANCE</small><h2>GARAGE TURBO KARTS</h2></div><button id="closeGarage">Retour au menu</button></header>
    <nav aria-label="Sections du garage"></nav><div class="premiumGrid"><div id="premiumStage"></div>
    <div class="premiumDetails"><div id="premiumBalance"></div><h3 id="premiumName"></h3><p id="premiumDescription"></p><div id="premiumStats"></div><button id="premiumBuy"></button><p id="premiumFeedback" role="status"></p><div id="premiumList"></div></div></div>
    <footer>Glisser : rotation 360° · Pincer / molette : zoom <label><input id="reduceGarageMotion" type="checkbox"> Réduire les animations</label></footer>`;
  document.body.append(page);
  let tab = 0;
  const get = (id: string) => page.querySelector<HTMLElement>('#' + id)!;
  const canvasHome = document.querySelector('.garageView')!;
  const stage = get('premiumStage');
  const button = (text: string, action: () => void, parent: Element) => {
    const b = document.createElement('button'); b.textContent = text; b.onclick = action; parent.append(b); return b;
  };
  const tabs = ['MES VÉHICULES', 'BOUTIQUE', 'AMÉLIORATIONS'];
  const render = () => {
    const g = options.garage(), v = VEHICLES[options.selected()], owned = g.owned.includes(v.id);
    get('premiumBalance').textContent = `${g.coins} Turbo Coins · ${owned ? 'Possédé' : `${v.price ?? 0} TC`}`;
    get('premiumName').textContent = v.name;
    get('premiumDescription').textContent = v.description;
    const p = upgradedProfile(vehicleProfile(ROSTER[0], v), g);
    get('premiumStats').textContent = `Vitesse ×${p.speed.toFixed(2)} · Accélération ×${p.accel.toFixed(2)} · Adhérence ×${p.grip.toFixed(2)} · Freinage ×${(p.brake ?? 1).toFixed(2)} (base 1,00)`;
    const buy = get('premiumBuy') as HTMLButtonElement;
    buy.textContent = owned ? 'Sélectionner pour la course' : `Acheter — ${v.price ?? 0} TC`;
    buy.disabled = !owned && g.coins < (v.price ?? 0);
    buy.onclick = () => {
      if (!owned) {
        const result = buyVehicle(g, v.id, v.price ?? 0);
        if (!result.ok) return;
        get('premiumFeedback').textContent = `${v.name} débloqué !`;
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches && !(get('reduceGarageMotion') as HTMLInputElement).checked)
          stage.animate([{ filter: 'brightness(2)' }, { filter: 'brightness(1)' }], { duration: 800 });
      } else get('premiumFeedback').textContent = `${v.name} prêt pour la course.`;
      g.selected = v.id; options.persist(); options.refresh(); render();
    };
    page.querySelectorAll('nav button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === tab)));
    const list = get('premiumList'); list.replaceChildren();
    if (tab === 2) {
      UPGRADE_KINDS.forEach((kind, i) => {
        const level = g.upgrades[v.id]?.[kind] ?? 0, cost = upgradeCost(kind, level);
        const b = button(`${labels[i]} · ${level}/5 · ×${(1 + level * 0.03).toFixed(2)} ${level === 5 ? 'MAX' : `→ ×${(1 + (level + 1) * 0.03).toFixed(2)} · ${cost} TC`}`, () => {
          const r = buyUpgrade(g, v.id, kind);
          if (r.ok) { options.persist(); options.refresh(); render(); }
        }, list);
        b.disabled = !owned || level === 5 || g.coins < cost;
      });
    } else VEHICLES.forEach((vehicle, index) => {
      if (g.owned.includes(vehicle.id) !== (tab === 0)) return;
      const b = button(`${vehicle.name} · ${vehicle.price ?? 0} TC · V ${vehicle.speed.toFixed(2)} / A ${vehicle.accel.toFixed(2)} / G ${vehicle.grip.toFixed(2)}`, () => {
        options.select(index); options.refresh(); get('premiumFeedback').textContent = ''; render();
      }, list);
      b.setAttribute('aria-pressed', String(index === options.selected()));
    });
  };
  tabs.forEach((text, index) => button(text, () => { tab = index; render(); }, page.querySelector('nav')!));
  const close = () => {
    page.hidden = true;
    document.getElementById('menu')!.style.visibility = '';
    const canvas = document.getElementById('garageCanvas'); if (canvas) canvasHome.prepend(canvas);
    options.refresh();
  };
  get('closeGarage').onclick = close;
  const reduce = get('reduceGarageMotion') as HTMLInputElement;
  reduce.checked = matchMedia('(prefers-reduced-motion: reduce)').matches;
  reduce.onchange = () => options.reduceMotion(reduce.checked);
  return {
    close,
    open() {
      page.hidden = false; document.getElementById('menu')!.style.visibility = 'hidden';
      stage.append(document.getElementById('garageCanvas')!);
      render();
    },
  };
}
