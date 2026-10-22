# jade-monitor

Vigilancia de caídas de la plataforma de Jade. Corre **fuera del servidor** (en GitHub Actions), así que avisa también si el VPS entero se cae.

## Qué hace

Cada **10 minutos** revisa los servicios de `targets.json`:

| Servicio | Qué se comprueba |
|---|---|
| API | Responde 200 y el cuerpo contiene `"status":"ok"` (así también detecta la **base de datos caída**: la API devuelve 503) |
| Web | Responde 200 y la página tiene `<title>` (no es una página de error de Traefik) |
| Panel | Responde 200 |
| Archivos (MinIO) | `/minio/health/live` responde 200 |

En todos además: tiempo de respuesta máximo (8 s) y **días de vida del certificado HTTPS** (avisa si quedan menos de 14).

Cada servicio se intenta **3 veces** con 10 s entre intentos: un parpadeo de red no genera una alarma. Solo falla si fallan los tres.

## Cómo te enteras

Si algo falla, el workflow **Vigilancia** termina en rojo y GitHub te envía un correo («Run failed: Vigilancia»). En la pestaña *Actions* → ejecución → *Summary* verás una tabla con qué servicio falla y por qué.

Para recibir esos correos:
1. GitHub → *Settings* → *Notifications* → sección **Actions**.
2. Activa **Send notifications for failed workflows only** y marca *Email*.
3. Pulsa **Watch → All activity** (o *Custom → Actions*) en este repositorio.

> Durante una caída larga llegará un correo por cada ejecución fallida (hasta 6 por hora). Es a propósito: mientras dure el problema, te lo sigue recordando.

## Cambiar de dominio o añadir servicios

Edita `targets.json` (lista de objetos). Campos:

| Campo | Obligatorio | Por defecto | Para qué |
|---|---|---|---|
| `name` | sí | | Nombre que aparece en la tabla |
| `url` | sí | | Dirección a comprobar |
| `expectStatus` | no | `200` | Código HTTP esperado |
| `expectBody` | no | | Texto que debe aparecer en la respuesta |
| `maxMs` | no | `8000` | Tiempo máximo de respuesta |
| `tlsDaysMin` | no | `14` | Días mínimos de vida del certificado |
| `attempts` / `retryDelayMs` / `timeoutMs` | no | `3` / `10000` / `15000` | Reintentos y tiempo de espera |

**Al pasar a producción:** cambia los cuatro dominios de `targets.json` por los definitivos y haz commit. Nada más.

## Probarlo en tu PC

```bash
node --test            # pruebas del script
node monitor.mjs       # comprueba los servicios de verdad (código de salida 1 si alguno falla)
```

Requiere Node 20 o superior; no tiene dependencias.

## Por qué es un repositorio público

Los minutos de GitHub Actions son **ilimitados en repositorios públicos** y de pago en los privados (2 000 al mes en el plan gratuito, que también usan las construcciones de las imágenes). Este repositorio solo contiene el script y los nombres de dominio de los servicios, que ya son públicos. **No guardes aquí secretos, claves ni datos de clientes.**

## Limitaciones honestas

* GitHub puede **retrasar** las ejecuciones programadas varios minutos cuando hay mucha carga; no es un monitor de precisión al segundo.
* No detecta problemas que no se vean desde fuera (un contenedor con la memoria casi llena, el disco del VPS). Eso se revisa en la pestaña *Monitoring* de Dokploy.
* Un workflow programado se desactiva tras 60 días sin actividad en el repositorio. El job **latido** (un commit del bot cada lunes) lo evita; si algún día dejas de recibir cualquier señal, comprueba que *Actions* sigue habilitado.
