-- Migration 083: Expand trusted source seed list for autonomous research
-- Adds more high-trust technical, standards, and institutional domains.

INSERT INTO source_trust_scores (domain, trust_score, category, update_reason) VALUES
  -- Standards and technical bodies
  ('ietf.org', 0.95, 'academic', 'Expanded trusted sources - internet standards body'),
  ('w3.org', 0.95, 'academic', 'Expanded trusted sources - web standards body'),
  ('ecma-international.org', 0.95, 'academic', 'Expanded trusted sources - language standards body'),

  -- Official language/runtime docs and foundations
  ('python.org', 0.90, 'technical', 'Expanded trusted sources - official language documentation'),
  ('nodejs.org', 0.90, 'technical', 'Expanded trusted sources - official runtime documentation'),
  ('rust-lang.org', 0.90, 'technical', 'Expanded trusted sources - official language documentation'),
  ('go.dev', 0.90, 'technical', 'Expanded trusted sources - official language documentation'),

  -- Core infrastructure/project docs
  ('postgresql.org', 0.90, 'technical', 'Expanded trusted sources - official database documentation'),
  ('nginx.org', 0.88, 'technical', 'Expanded trusted sources - official web server documentation'),
  ('kubernetes.io', 0.90, 'technical', 'Expanded trusted sources - official orchestration docs'),
  ('docker.com', 0.85, 'technical', 'Expanded trusted sources - official container platform docs'),
  ('openssl.org', 0.90, 'technical', 'Expanded trusted sources - official cryptography toolkit docs'),
  ('linuxfoundation.org', 0.88, 'technical', 'Expanded trusted sources - foundation and governance docs'),

  -- Major cloud/platform docs
  ('cloud.google.com', 0.88, 'technical', 'Expanded trusted sources - official cloud documentation'),
  ('learn.microsoft.com', 0.88, 'technical', 'Expanded trusted sources - official platform documentation'),
  ('docs.aws.amazon.com', 0.88, 'technical', 'Expanded trusted sources - official cloud documentation'),

  -- Government and institutional technical/measurement references
  ('nist.gov', 0.92, 'academic', 'Expanded trusted sources - standards and measurement institute'),
  ('cisa.gov', 0.90, 'technical', 'Expanded trusted sources - cybersecurity agency guidance'),
  ('us-cert.cisa.gov', 0.90, 'technical', 'Expanded trusted sources - incident response advisories'),
  ('nasa.gov', 0.90, 'academic', 'Expanded trusted sources - science and mission publications'),
  ('usgs.gov', 0.88, 'academic', 'Expanded trusted sources - geoscience and data publications'),
  ('noaa.gov', 0.88, 'academic', 'Expanded trusted sources - climate and weather data publications'),
  ('who.int', 0.88, 'academic', 'Expanded trusted sources - global public health institution'),

  -- Peer-review and research tooling
  ('jstor.org', 0.90, 'academic', 'Expanded trusted sources - academic archive'),
  ('pubmed.ncbi.nlm.nih.gov', 0.92, 'academic', 'Expanded trusted sources - biomedical literature index'),
  ('doi.org', 0.90, 'academic', 'Expanded trusted sources - persistent scholarly identifier registry')
ON CONFLICT (domain) DO NOTHING;
