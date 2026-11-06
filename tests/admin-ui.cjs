/* Integration QA against a dedicated LOCAL preview. Creates and removes test content. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TIAGO_QA_URL || 'http://127.0.0.1:4180';
assert.equal(new URL(base).hostname, '127.0.0.1', 'UI tests may run only on a local dedicated preview.');
assert.ok(process.env.TIAGO_QA_PASSWORD, 'Provide an ephemeral preview password through the environment.');
const artifacts = process.env.TIAGO_QA_ARTIFACTS;
const report = { widths: [], errors: [], flows: [] };
const sizes = [[320,568],[390,844],[430,932],[600,390],[768,1024],[1280,720],[1366,768]];
let browser;
async function noOverflow(page, label) {
  const result = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, width: innerWidth, dialog: [...document.querySelectorAll('dialog[open]')].map(el => ({scroll:el.scrollWidth,width:el.clientWidth})) }));
  assert.ok(result.page <= result.width + 1, `${label}: horizontal page overflow ${JSON.stringify(result)}`);
  result.dialog.forEach(dialog => assert.ok(dialog.scroll <= dialog.width + 1, `${label}: dialog overflow`));
}
async function save(page) { await page.locator('#save-item').click(); await page.locator('#editor').waitFor({state:'hidden'}); await page.waitForFunction(() => document.querySelector('#app-status').textContent.length > 0); }
async function gotoKind(page, kind) { await page.locator(`#admin-nav [data-view="${kind}"]`).click(); }
async function add(page, kind, title) { await gotoKind(page,kind); await page.locator('#add-item').click(); await page.locator('#edit-title').fill(title); }
async function remove(page, kind, title) { await gotoKind(page,kind); await page.getByRole('button',{name:`Editar ${title}`,exact:true}).click(); await page.locator('#delete-item').click(); await page.locator('#confirm-delete').click(); await page.locator('#editor').waitFor({state:'hidden'}); }
(async () => {
  browser = await chromium.launch({channel:'msedge',headless:true});
  const context = await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  const page = await context.newPage(); page.on('pageerror',error => report.errors.push(error.message));
  await page.goto(`${base}/admin/`,{waitUntil:'networkidle'});
  for (const [width,height] of sizes) { await page.setViewportSize({width,height}); await noOverflow(page,`login ${width}`); report.widths.push({width,height,login:true}); }
  if (artifacts) { await page.setViewportSize({width:1280,height:720}); await page.evaluate(()=>scrollTo(0,0)); await page.screenshot({path:path.join(artifacts,'admin-login-notebook.png')}); await page.setViewportSize({width:390,height:844}); await page.evaluate(()=>scrollTo(0,0)); await page.screenshot({path:path.join(artifacts,'admin-login-mobile.png'),fullPage:true}); }
  await page.locator('#username').fill(process.env.TIAGO_QA_USER || 'qa-local'); await page.locator('#password').fill(process.env.TIAGO_QA_PASSWORD); await page.locator('#login-form button[type=submit]').click(); await page.locator('#admin-view').waitFor({state:'visible'}); report.flows.push('real login');
  for (const [width,height] of sizes) { await page.setViewportSize({width,height}); await noOverflow(page,`dashboard ${width}`); }
  if (artifacts) { await page.setViewportSize({width:1280,height:720}); await page.evaluate(()=>scrollTo(0,0)); await page.screenshot({path:path.join(artifacts,'admin-dashboard-notebook.png')}); await page.setViewportSize({width:390,height:844}); await page.evaluate(()=>scrollTo(0,0)); await page.screenshot({path:path.join(artifacts,'admin-dashboard-mobile.png'),fullPage:true}); }
  await add(page,'companies','TESTE LOCAL · Empresa');
  await page.locator('#edit-city').fill('Tianguá'); await page.locator('#edit-category').fill('Turismo'); await page.locator('#edit-description').fill('Registro de teste local. Não é conteúdo real.');
  await page.locator('#edit-upload').setInputFiles(path.join(__dirname,'../assets/serra-nuvens-mobile.webp'));
  await page.waitForFunction(() => document.querySelector('#editor input[name=image]').value.startsWith('/media/'));
  for (const [width,height] of sizes) { await page.setViewportSize({width,height}); await noOverflow(page,`editor ${width}`); const close = await page.locator('#close-editor').boundingBox(); assert.ok(close && close.y>=0 && close.y+close.height<=height,`close button visible ${width}`); }
  await page.setViewportSize({width:390,height:844}); await save(page);
  let content = await (await context.request.get(`${base}/api/public/content`)).json(); assert.ok(!content.companies.some(item=>item.title==='TESTE LOCAL · Empresa'),'draft invisible'); report.flows.push('upload and private draft');
  await page.getByRole('button',{name:'Editar TESTE LOCAL · Empresa',exact:true}).click(); await page.locator('#edit-published').check(); await save(page);
  content = await (await context.request.get(`${base}/api/public/content`)).json(); const company = content.companies.find(item=>item.title==='TESTE LOCAL · Empresa'); assert.ok(company?.image?.startsWith('/media/')); report.flows.push('publish company');
  await add(page,'catalog_items','TESTE LOCAL · Serviço'); await page.locator('#edit-company_id').selectOption(company.id); await page.locator('#edit-price_text').fill('Sob consulta'); await page.locator('#edit-published').check(); await save(page); report.flows.push('catalog linked to company');
  await add(page,'events','TESTE LOCAL · Evento'); await page.locator('#edit-location').fill('Local de teste'); await page.locator('#edit-start_at').fill('2027-06-01T18:00'); await page.locator('#edit-published').check(); await save(page);
  await add(page,'projects','TESTE LOCAL · Projeto'); await page.locator('#edit-status').selectOption('planning'); await page.locator('#edit-published').check(); await save(page);
  await add(page,'partners','TESTE LOCAL · Parceiro'); await page.locator('#edit-city').fill('Ubajara'); await page.locator('#edit-published').check(); await save(page); report.flows.push('event, project, partner in another city');
  const visitor = await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}); const publicPage = await visitor.newPage(); publicPage.on('pageerror',e=>report.errors.push(e.message)); await publicPage.goto(base,{waitUntil:'networkidle'}); await publicPage.getByText('TESTE LOCAL · Empresa',{exact:true}).first().waitFor({state:'visible'}); assert.ok(await publicPage.getByText('TESTE LOCAL · Evento',{exact:true}).count()); assert.ok(await publicPage.getByText('TESTE LOCAL · Projeto',{exact:true}).count()); await noOverflow(publicPage,'live public content'); report.flows.push('real public API integration'); await visitor.close();
  await gotoKind(page,'partners'); await page.locator('#record-city').selectOption('Ubajara'); assert.equal(await page.locator('#record-list .record').count(),1); report.flows.push('city filter');
  await gotoKind(page,'settings'); const originalIntro = await page.locator('#site_intro').inputValue(); await page.locator('#site_intro').fill('Texto temporário para verificar o painel.'); await page.locator('#settings-form button[type=submit]').click(); await page.waitForFunction(()=>document.querySelector('#app-status').textContent.includes('atualizados')); content=await(await context.request.get(`${base}/api/public/content`)).json(); assert.equal(content.settings.site_intro,'Texto temporário para verificar o painel.'); await page.locator('#site_intro').fill(originalIntro); await page.locator('#settings-form button[type=submit]').click(); await page.waitForFunction(()=>!document.querySelector('#settings-form button').disabled); report.flows.push('settings saved and restored');
  for (const [kind,title] of [['catalog_items','Serviço'],['events','Evento'],['projects','Projeto'],['partners','Parceiro'],['companies','Empresa']]) await remove(page,kind,`TESTE LOCAL · ${title}`);
  report.flows.push('confirmed deletion');
  await context.clearCookies(); await gotoKind(page,'settings'); await page.locator('#settings-form button[type=submit]').click(); await page.locator('#login-view').waitFor({state:'visible'});
  await page.locator('#password').fill(process.env.TIAGO_QA_PASSWORD); await page.locator('#login-form button[type=submit]').click(); await page.locator('#admin-view').waitFor({state:'visible'}); report.flows.push('session expiry recovers with new login');
  await page.locator('#logout').click(); await page.locator('#login-view').waitFor({state:'visible'}); assert.equal((await context.request.get(`${base}/api/admin/content`)).status(),401); report.flows.push('logout revokes access');
  assert.deepEqual(report.errors,[]); if(artifacts)fs.writeFileSync(path.join(artifacts,'admin-browser-report.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
})().catch(error=>{ console.error(error.stack); process.exitCode=1; }).finally(async()=>{if(browser)await browser.close();});
