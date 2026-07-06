# Instruções do projeto — WishBoard

## REGRA CRÍTICA: preservar os dados dos usuários

Os dados dos usuários (contas e links salvos) NÃO ficam nos arquivos deste
projeto — eles moram no `localStorage` do navegador de cada pessoa. Portanto,
qualquer edição de código precisa manter compatibilidade com os dados que já
existem no navegador dos usuários. Perder esse acesso significa, na prática,
"apagar" os links que a pessoa já reuniu.

### Nunca renomeie ou altere estas chaves do localStorage

- `wishboard:users` — cadastro das contas (usuário + hash da senha)
- `wishboard:currentUser` — usuário logado no momento
- `productWishlist:items:v2:<usuario>` — os itens/links de cada usuário

Renomear qualquer uma dessas chaves faz os usuários existentes perderem acesso
aos dados que já salvaram. Se precisar mudar, veja "Mudanças de formato".

### Não quebre o formato dos itens já salvos

Cada item salvo tem estes campos. Não remova nem renomeie campos que itens
antigos já usam; prefira sempre mudanças aditivas (adicionar campos novos com
um valor padrão seguro para itens que ainda não os tenham):

`id`, `url`, `title`, `description`, `image`, `category`, `price`, `addedAt`,
`order`, `includeInTotal`

### Mudanças de formato ou de chave

Se uma mudança nas chaves ou no formato dos dados for realmente necessária:

1. Avise antes de fazer e explique o impacto.
2. Escreva uma migração que leia os dados no formato antigo e os converta para
   o novo, sem descartar nada. Nunca troque a chave sem migrar o conteúdo.
3. Só prossiga após confirmação.

## Contexto rápido

Site estático (HTML/CSS/JS puro, sem build), publicado no GitHub Pages.
Login simples baseado em localStorage (ver `auth.js`) — não é segurança real,
serve apenas para separar o conteúdo de cada pessoa. Nada sensível é guardado.
