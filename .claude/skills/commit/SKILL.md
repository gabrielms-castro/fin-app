---
description: Cria commits git atômicos e bem formatados. Use quando o usuario pedir para commitar, criar commit, ou "/commit".
allowed-tools: "Bash(git *) Read"
---

# Git Commit Skill

Analisa todas as mudanças do repositório e cria **commits atômicos** seguindo conventional commits.

## Usage
```
/commit
```

## Behavior
1. **Analise tudo o que mudou no repositório**, não só o que está staged:
   - `git status --short` (inclui arquivos novos/não rastreados)
   - `git diff` e `git diff --staged` (conteúdo das mudanças)
   - `git log --oneline -10` (padrão de mensagens do projeto)
2. **Agrupe as mudanças em unidades lógicas independentes** (uma feature, um fix, um refactor, docs, config…).
   Cada grupo vira um commit separado.
3. Para cada grupo, em ordem de dependência (o que é usado vem antes de quem usa):
   - `git add <arquivos do grupo>` — ou `git add -p <arquivo>` quando um mesmo arquivo mistura mudanças de grupos diferentes
   - confira com `git diff --staged --stat`
   - crie o commit com a mensagem do grupo
4. No fim, `git status` deve estar limpo (exceto arquivos ignorados) e `git log --oneline` deve contar a história das mudanças.

## Regras

- **Nunca adicione `Co-Authored-By` ou qualquer trailer de co-autoria no commit.**
- **Commits atômicos: nunca junte tudo em um único commit.** Cada commit faz uma única coisa, tem uma mensagem que
  descreve só essa coisa e, sempre que possível, deixa o projeto funcionando (testes junto do código que testam).
- Se a descrição do commit precisa de "e" para juntar assuntos não relacionados, divida-o.
- Mudanças de formatação/refactor ficam separadas de mudanças de comportamento.
- Nunca commite segredos ou artefatos locais (`.env`, bancos `*.sqlite3`, `.venv/`, `__pycache__/`). Confira antes de cada commit.
- Não use `git add -A`/`git add .` para criar um commit só; adicione os arquivos de cada grupo explicitamente.

## Commit Format
```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

## Types
- feat: New feature
- fix: Bug fix
- docs: Documentation changes
- style: Code style changes
- refactor: Code refactoring
- test: Adding or modifying tests
- chore: Maintenance tasks

## Example Output
Mudanças: novo endpoint de reset de senha, correção no login e README atualizado → três commits:
```
feat(auth): add password reset flow

- Add forgot password form
- Add password reset endpoint
```
```
fix(auth): keep "next" redirect after login
```
```
docs: document password reset in README
```
