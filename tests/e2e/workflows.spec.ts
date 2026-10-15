import { test, expect, type Page } from '@playwright/test';
import { TEST_PASSWORD } from '../helpers.js';
async function login(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', {
    exact: true
  }).fill(TEST_PASSWORD);
  await page.getByRole('button', {
    name: 'Sign in to workspace'
  }).click();
  await expect(page.getByRole('heading', {
    name: /A clearer view|overview/
  })).toBeVisible();
}
test('employee drafts, submits and admin reviews a real persisted daily report', async ({
  page
}) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await login(page, 'outreach@example.test');
  await page.getByRole('button', {
    name: 'New daily report',
    exact: true
  }).click();
  await page.getByRole('button', {
    name: /Qualified outreach/
  }).click();
  await page.getByLabel('Actual quantity').fill('18');
  await page.locator('.activity .evidence-links input[type=url]').nth(0).fill('https://example.test/prospect-list');
  await page.getByRole('button', {
    name: 'Add link'
  }).click();
  await page.locator('.activity .evidence-links input[type=url]').nth(1).fill('https://example.test/campaign');
  await page.getByLabel('Key achievements *', {
    exact: true
  }).fill('Fixture: qualified outreach completed');
  await page.getByLabel('Plan for the next working day *', {
    exact: true
  }).fill('Fixture: follow up with prospects');
  await page.locator('input[type=file]').setInputFiles([{
    name: 'fixture-leads.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Prospect,Replies,Meetings\r\nNorthstar,4,2\r\nOrchard,3,1\r\n')
  }, {
    name: 'notes.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from('Fixture attachment')
  }]);
  await expect(page.getByRole('status')).toContainText('Draft and attachments saved');
  await expect(page.locator('.file-row').filter({
    hasText: 'fixture-leads.csv'
  }).first()).toBeVisible();
  await expect(page.locator('.file-row').filter({
    hasText: 'notes.docx'
  }).first()).toBeVisible();
  await page.getByRole('button', {
    name: 'Submit report',
    exact: true
  }).click();
  await expect(page.getByRole('status')).toContainText('Report submitted');
  await expect(page.getByText('submitted', {
    exact: true
  })).toBeVisible();
  await page.getByRole('button', {
    name: 'Sign out',
    exact: true
  }).click();
  await login(page, 'admin@example.test');
  await page.getByRole('button', {
    name: 'Daily reports',
    exact: true
  }).click();
  await page.getByRole('button', {
    name: /Open report .*Fixture Outreach/
  }).click();
  await expect(page.getByRole('link', { name: 'Open link 1' })).toHaveAttribute('href', 'https://example.test/prospect-list');
  await expect(page.getByRole('link', { name: 'Open link 2' })).toHaveAttribute('href', 'https://example.test/campaign');
  await page.getByLabel('Review comment').fill('Fixture: clear and measurable results');
  await page.getByLabel('Quality score (optional, 0–100)').fill('90');
  await page.getByLabel('Learning score (optional, 0–100)').fill('80');
  await page.getByLabel('Action', {
    exact: true
  }).selectOption('approve');
  await page.getByRole('button', {
    name: 'Record review'
  }).click();
  await expect(page.getByText('approved', {
    exact: true
  })).toBeVisible();
  await expect(page.getByRole('heading', {
    name: 'Uploaded file dashboard'
  })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New daily report', exact: true })).toHaveCount(0);
  await expect(page.getByRole('cell', {
    name: 'Northstar'
  })).toBeVisible();
  const reportData = page.locator('.report-upload-insights');
  await reportData.getByLabel('Filter · Prospect').selectOption({ label: 'Northstar' });
  await expect(reportData.locator('tbody tr')).toHaveCount(1);
  await expect(reportData.getByRole('cell', { name: 'Northstar' })).toBeVisible();
  await expect(reportData.getByRole('cell', { name: 'Orchard' })).toHaveCount(0);
  await reportData.getByLabel('Filter · Prospect').selectOption('');
  await expect(reportData.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('button', {
    name: 'Team overview',
    exact: true
  }).click();
  await expect(page.getByRole('heading', {
    name: 'A clearer view of your team.'
  })).toBeVisible();
  await page.getByRole('button', { name: 'View Fixture Outreach' }).click();
  await expect(page.getByRole('heading', { name: 'Fixture Outreach’s overview' })).toBeVisible();
  const individualUploads = page.locator('.uploaded-insights');
  const prospectFilter = individualUploads.getByLabel('Filter · Prospect');
  await expect(prospectFilter).toBeVisible();
  await expect(prospectFilter.locator('option', { hasText: 'Northstar' })).toHaveCount(1);
  await prospectFilter.selectOption({ label: 'Northstar' });
  await expect(individualUploads.locator('.uploaded-table-heading + .table-scroll tbody tr')).toHaveCount(1);
  await expect(individualUploads.locator('.uploaded-table-heading + .table-scroll tbody')).toContainText('Northstar');
  await prospectFilter.selectOption('');
  await page.getByRole('button', {
    name: 'Uploaded files',
    exact: true
  }).click();
  await expect(page.getByRole('heading', {
    name: 'Uploaded report data'
  })).toBeVisible();
  await expect(page.getByRole('heading', {
    name: 'Metric profile'
  })).toBeVisible();
  await expect(page.getByRole('heading', {
    name: 'Uploaded items'
  })).toBeVisible();
  await expect(page.getByRole('cell', {
    name: 'Fixture Outreach'
  }).first()).toBeVisible();
  await expect(page.getByRole('cell', {
    name: 'fixture-leads.csv'
  }).first()).toBeVisible();
  await page.screenshot({
    path: 'test-results/dashboard-desktop.png',
    fullPage: true
  });
  await page.getByRole('button', {
    name: 'Reports & exports',
    exact: true
  }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', {
    name: /PDF report/
  }).click();
  const download = await downloadPromise;
  await download.saveAs('test-results/fixture-team.pdf');
  expect(errors).toEqual([]);
});
test('admin creates and deactivates an employee through the interface', async ({
  page
}) => {
  await login(page, 'admin@example.test');
  await page.getByRole('button', {
    name: 'Team members',
    exact: true
  }).click();
  await page.getByRole('button', {
    name: 'Add team member'
  }).click();
  await page.getByLabel('Full name', {
    exact: true
  }).fill('Fixture UI Employee');
  await page.getByLabel('Email address', {
    exact: true
  }).fill('ui@example.test');
  await page.getByLabel('Employee identifier').fill('UI-TEST-001');
  await page.getByLabel('Job role', {
    exact: true
  }).selectOption({
    label: 'Outreach Specialist'
  });
  await page.getByLabel('Initial password (12+ characters)').fill(TEST_PASSWORD);
  await page.getByLabel('LinkedIn', {
    exact: true
  }).check();
  await page.getByRole('button', {
    name: 'Save employee',
    exact: true
  }).click();
  await expect(page.getByRole('status')).toContainText('Employee profile saved');
  const row = page.getByRole('row').filter({
    hasText: 'Fixture UI Employee'
  });
  page.once('dialog', dialog => dialog.accept());
  await row.getByRole('button', {
    name: 'Deactivate',
    exact: true
  }).click();
  await expect(row.getByText('inactive', {
    exact: true
  })).toBeVisible();
  await page.getByRole('button', {
    name: 'Team overview',
    exact: true
  }).click();
  await page.getByRole('region', {
    name: 'Report filters'
  }).getByLabel('Employee', {
    exact: true
  }).selectOption({
    label: 'Fixture UI Employee (inactive)'
  });
  await expect(page.getByRole('heading', {
    name: /Fixture UI Employee.*overview/
  })).toBeVisible();
});
test('mobile layouts, navigation, empty and error states remain usable', async ({
  page
}) => {
  await page.setViewportSize({
    width: 320,
    height: 740
  });
  await login(page, 'admin@example.test');
  await expect(page.getByRole('heading', {
    name: 'A clearer view of your team.'
  })).toBeVisible();
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({
      width,
      height: 900
    });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
  await page.setViewportSize({
    width: 320,
    height: 740
  });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.getByRole('button', {
    name: 'Open navigation'
  }).click();
  await page.getByRole('button', {
    name: 'Notifications',
    exact: true
  }).click();
  await expect(page.getByRole('heading', {
    name: 'Your reporting inbox.'
  })).toBeVisible();
  await page.screenshot({
    path: 'test-results/notifications-mobile.png',
    fullPage: true
  });
  await page.getByRole('button', {
    name: 'Open navigation'
  }).click();
  await page.getByRole('button', {
    name: 'Daily reports',
    exact: true
  }).click();
  await expect(page.getByRole('button', { name: 'New daily report', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Open report/ }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.getByRole('button', {
    name: 'Open navigation'
  }).click();
  await page.getByRole('button', {
    name: 'Team overview',
    exact: true
  }).click();
  await page.route('**/api/analytics?**', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({
      error: 'Fixture: service temporarily unavailable'
    })
  }));
  await page.getByLabel('From', {
    exact: true
  }).fill('2026-10-02');
  await expect(page.getByRole('alert')).toContainText('Fixture: service temporarily unavailable');
});
