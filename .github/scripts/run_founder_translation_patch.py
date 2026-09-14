from pathlib import Path

p = Path('.github/scripts/restore_founder_auto_translation.py')
s = p.read_text(encoding='utf-8')
s = s.replace("r'(?m)^// @version\\\\s+\\\\S+'", "r'(?m)^// @version\\s+\\S+'")
s = s.replace("m='      .ct-twitter-logo {'", "m='.ct-twitter-logo {'")
s = s.replace("r'  async function patchArticle\\\\([\\\\s\\\\S]*?(?=  function collectArticles\\\\()'", "r'  async function patchArticle\\([\\s\\S]*?(?=  function collectArticles\\()'")
compile(s, str(p), 'exec')
exec(compile(s, str(p), 'exec'), {'__name__': '__main__'})
