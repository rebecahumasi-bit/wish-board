---
description: Analisa as alterações, cria uma mensagem de commit descritiva e publica no GitHub (add + commit + push).
---

Publique as alterações atuais do projeto no GitHub, seguindo estes passos:

1. Rode `git status` e `git diff` (e `git diff --staged`) para entender exatamente o que mudou desde o último commit. Inclua também arquivos novos (não rastreados).

2. Com base nas mudanças reais, escreva UMA mensagem de commit em português, curta e descritiva, no modo imperativo. Ela deve resumir o QUE mudou e, se ajudar, o PORQUÊ. Não use mensagens genéricas como "atualizações".

3. Rode `git add -A` para incluir todas as alterações (modificados, novos e removidos).

4. Faça o commit com a mensagem que você escreveu.

5. Faça `git push`. Se for o primeiro push do branch, use `git push -u origin main`.

6. No final, me diga qual mensagem de commit você usou e confirme que o push foi concluído.

Se não houver nenhuma alteração para publicar, apenas me avise que já está tudo atualizado, sem criar commit vazio.