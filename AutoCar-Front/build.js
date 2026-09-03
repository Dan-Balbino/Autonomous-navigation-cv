/**
 * Script de build para ofuscar e minificar o código
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('Iniciando processo de ofuscação e minificação...\n');

// Cria diretório dist se não existir
const distDir = join(__dirname, 'dist');
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

// Se a pasta src não existir, assume build pré-gerado e evita erro
const srcDir = join(__dirname, 'src');
const srcStylesPath = join(srcDir, 'styles.css');
const srcConfigPath = join(srcDir, 'config', 'faceConfig.json');
const srcExists = existsSync(srcDir);

if (!srcExists || !existsSync(srcStylesPath)) {
  console.log('Pasta src não encontrada. Pulando build e mantendo dist existente.');
  process.exit(0);
}

// Copia index.html para dist
console.log('Copiando index.html...');
const indexHtml = readFileSync(join(__dirname, 'index.html'), 'utf-8');
// Atualiza os caminhos dos scripts para apontar para dist
const updatedHtml = indexHtml
  .replace('./src/main.js', './main.js')
  .replace('./src/styles.css', './styles.css');
writeFileSync(join(distDir, 'index.html'), updatedHtml);

// Copia 404.html se existir
const notFoundPath = join(__dirname, '404.html');
if (existsSync(notFoundPath)) {
  console.log('Copiando 404.html...');
  const notFoundHtml = readFileSync(notFoundPath, 'utf-8');
  writeFileSync(join(distDir, '404.html'), notFoundHtml);
}

// Copia styles.css
console.log('Copiando styles.css...');
const stylesCss = readFileSync(srcStylesPath, 'utf-8');
writeFileSync(join(distDir, 'styles.css'), stylesCss);

// Copia src base para garantir arquivos no dist
cpSync(srcDir, join(distDir, 'src'), { recursive: true, force: true });

const runningOnVercel = Boolean(process.env.VERCEL);
const forceObfuscate = process.env.OBFUSCATE === 'true';
const shouldObfuscate = forceObfuscate || !runningOnVercel;

if (shouldObfuscate) {
  console.log('Ofuscando código JavaScript...');
  try {
    execSync('npx javascript-obfuscator src --output dist/src --config obfuscator.config.json', {
      stdio: 'inherit',
      cwd: __dirname
    });
    console.log('Ofuscação concluída.\n');
  } catch (error) {
    console.error('Erro ao ofuscar código:', error.message);
    console.error('Ofuscação é obrigatória. Interrompendo o build.');
    process.exit(1);
  }
} else {
  console.log('Ofuscação desativada no ambiente de deploy.');
}

// Atualiza caminhos no index.html para apontar para src ofuscado
const finalHtml = readFileSync(join(distDir, 'index.html'), 'utf-8')
  .replace('./main.js', './src/main.js');
writeFileSync(join(distDir, 'index.html'), finalHtml);

// Copia config JSON por último para evitar que o obfuscator altere o arquivo
console.log('Copiando faceConfig.json...');
const configJson = readFileSync(srcConfigPath, 'utf-8');

// Mantem compatibilidade com o caminho usado no fetch (./src/config/faceConfig.json)
const distSrcConfigDir = join(distDir, 'src', 'config');
if (!existsSync(distSrcConfigDir)) {
  mkdirSync(distSrcConfigDir, { recursive: true });
}
writeFileSync(join(distSrcConfigDir, 'faceConfig.json'), configJson);

// Copia para caminho alternativo usado como fallback (./config/faceConfig.json)
const distConfigDir = join(distDir, 'config');
if (!existsSync(distConfigDir)) {
  mkdirSync(distConfigDir, { recursive: true });
}
writeFileSync(join(distConfigDir, 'faceConfig.json'), configJson);

console.log('Build concluído! Os arquivos ofuscados estão em: dist/');
console.log('Use os arquivos da pasta dist/ para produção.\n');

