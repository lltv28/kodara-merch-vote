const f = document.getElementById('f');
const go = document.getElementById('go');
const count = document.getElementById('count');
const err = document.getElementById('err');
const nameEl = document.getElementById('name');
const boxes = [...f.querySelectorAll('input[name=items]')];

function update() {
  const n = boxes.filter((b) => b.checked).length;
  boxes.forEach((b) => { b.disabled = n >= 2 && !b.checked; });
  count.textContent = `${n} of 2 picked`;
  go.disabled = !(nameEl.value.trim() && n === 2);
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
      body: JSON.stringify({ name: nameEl.value, items: boxes.filter((b) => b.checked).map((b) => b.value) }),
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
