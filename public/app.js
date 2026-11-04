const f = document.getElementById('f');
const go = document.getElementById('go');
const count = document.getElementById('count');
const err = document.getElementById('err');
const nameEl = document.getElementById('name');
const boxes = [...f.querySelectorAll('input[name=items]')];

const size = () => f.querySelector('input[name=size]:checked')?.value || '';

// Submit needs a name plus 2 picks, a size, or both (returning voters can add just a size).
function update() {
  const n = boxes.filter((b) => b.checked).length;
  boxes.forEach((b) => { b.disabled = n >= 2 && !b.checked; });
  count.textContent = `${size() ? `Size ${size()}` : 'No size'} · ${n} of 2 picked`;
  go.disabled = !(nameEl.value.trim() && (n === 2 || (n === 0 && size())));
}
f.addEventListener('input', update);
update();

f.addEventListener('submit', async (e) => {
  e.preventDefault();
  go.disabled = true;
  err.hidden = true;
  try {
    const r = await fetch('/api/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nameEl.value, size: size(), items: boxes.filter((b) => b.checked).map((b) => b.value) }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Something went wrong. Try again.');
    document.getElementById('vote').hidden = true;
    document.getElementById('thanks').hidden = false;
    scrollTo(0, 0);
  } catch (x) {
    err.textContent = x.message;
    err.hidden = false;
    update();
  }
});

const lb = document.getElementById('lightbox');
const lbImg = lb.querySelector('img');
let opener;
f.addEventListener('click', (e) => {
  const btn = e.target.closest('.zoom');
  if (!btn) return;
  e.preventDefault(); // keep the card's checkbox untouched
  const img = btn.parentElement.querySelector('img');
  lbImg.src = img.src;
  lbImg.alt = img.alt;
  opener = btn;
  if (lb.showModal) lb.showModal(); else lb.setAttribute('open', ''); // iOS < 15.4 has no showModal
});
lb.addEventListener('click', (e) => { if (e.target !== lbImg) lb.close ? lb.close() : (lb.removeAttribute('open'), opener && opener.focus()); });
lb.addEventListener('close', () => opener && opener.focus());
