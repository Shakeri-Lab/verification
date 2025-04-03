const apiUrl = 'https://your-eb-env.eba-xxx.us-west-2.elasticbeanstalk.com'; // Replace with your EB URL

async function startSession() {
  const id = document.getElementById('computing_id').value;

  await fetch(`${apiUrl}/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ computing_id: id })
  });

  loadNextGroup();
}

async function loadNextGroup() {
  const res = await fetch(`${apiUrl}/`, {
    method: 'GET',
    credentials: 'include'
  });

  const html = await res.text();

  // Parse returned HTML to extract group info using DOMParser (not perfect but works)
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const groupName = doc.querySelector('#group-name')?.textContent;
  const diagnoses = [...doc.querySelectorAll('#diagnosis-list li')].map(el => el.textContent);

  if (!groupName) {
    // Reached /done
    document.getElementById('step1').style.display = 'none';
    document.getElementById('step2').style.display = 'none';
    document.getElementById('step3').style.display = 'block';

    const doneRes = await fetch(`${apiUrl}/done`, { credentials: 'include' });
    const doneHtml = await doneRes.text();
    const doneDoc = parser.parseFromString(doneHtml, 'text/html');
    const pre = doneDoc.querySelector('pre');

    document.getElementById('verified-output').textContent = pre?.textContent || "Done!";
    return;
  }

  // Show verification step
  document.getElementById('step1').style.display = 'none';
  document.getElementById('step2').style.display = 'block';
  document.getElementById('step3').style.display = 'none';

  document.getElementById('group-name').textContent = groupName;
  const list = document.getElementById('diagnosis-list');
  list.innerHTML = '';
  diagnoses.forEach(d => {
    const li = document.createElement('li');
    li.textContent = d;
    list.appendChild(li);
  });
}

async function submitVerification(response) {
  const formData = new URLSearchParams();
  formData.append('group_valid', response);
  formData.append('new_group_name', document.getElementById('new-group-name').value);

  await fetch(`${apiUrl}/verify`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData
  });

  loadNextGroup();
}

function restart() {
  window.location.reload();
}
