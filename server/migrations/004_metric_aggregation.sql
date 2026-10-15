ALTER TABLE kpis ADD COLUMN aggregation TEXT NOT NULL DEFAULT 'sum' CHECK(aggregation IN('sum','average'));
UPDATE kpis SET aggregation='average' WHERE unit='percent';
UPDATE kpis SET kind='achievement' WHERE name='Tests passed' AND unit='count';
INSERT INTO kpis(name,description,category_id,unit,kind,aggregation) SELECT 'Outreach accuracy','Record the daily percentage meeting the qualification standard.',id,'percent','quality','average' FROM categories WHERE name='LinkedIn';
INSERT INTO kpis(name,description,category_id,unit,kind,aggregation) SELECT 'Proposal quality','Record the reviewed daily proposal quality percentage.',id,'percent','quality','average' FROM categories WHERE name='Upwork';
INSERT INTO kpis(name,description,category_id,unit,kind,aggregation) SELECT 'Audit accuracy','Record the daily percentage of validated audit findings.',id,'percent','quality','average' FROM categories WHERE name='Website Audits and SEO';
INSERT INTO kpis(name,description,category_id,unit,kind,aggregation) SELECT 'Test pass rate','Record the daily test pass percentage; test volume is tracked separately.',id,'percent','quality','average' FROM categories WHERE name='Automation';
