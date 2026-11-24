# Tests del backend

Pruebas de integración con el runner nativo de Node (`node:test`), sin
dependencias extra. **Corren contra una base PostgreSQL aislada y la vacían
(`TRUNCATE`)**: nunca apuntarlas a la base de desarrollo ni a producción.

`tests/helpers/testDb.js` aborta si `TEST_DATABASE_URL`:
- no está definida (nunca usa `DATABASE_URL` del `.env`),
- no apunta a `localhost` / `127.0.0.1`,
- o el nombre de la base no termina en `_test`.

## Preparar una base aislada (ejemplo con un clúster temporal)

```bash
PG=/Library/PostgreSQL/18/bin          # o el bin de tu instalación
DATA=$(mktemp -d)/pgdata
$PG/initdb -D "$DATA" -U postgres --auth=trust
$PG/pg_ctl -D "$DATA" -o "-p 55432 -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l "$DATA.log" start
$PG/createdb -h 127.0.0.1 -p 55432 -U postgres 3cars_test

export TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/3cars_test"
DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy
```

## Ejecutar

```bash
TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/3cars_test" npm test
```

- `TEST_VERBOSE=1` muestra los logs de los servicios.
- Conviene correrla también con otras zonas horarias del servidor:
  `TZ=UTC npm test` y `TZ=America/Argentina/Buenos_Aires npm test`.

Al terminar: `$PG/pg_ctl -D "$DATA" stop` y borrar el directorio temporal.

## Qué cubren

- `modificacionCuota.test.js`: modificar valor de cuota — reducción / aumento,
  pagos parciales, ajustes previos, cuota objetivo, cargos, planes CAÍDOS,
  estados bloqueados, vista previa versionada, concurrencia, rollback y cuotas
  futuras de "pago abierto". Tras cada caso se verifican invariantes globales:
  imputaciones, ajustes, estados y Caja por cuota.
- `reactivacion.test.js`: planes CAÍDOS — pago dirigido (`planId`), pagos
  parciales acumulados, reactivación explícita (con y sin pago previo, rechazo
  con 3+ vencidas, baja manual / origen desconocido), estados terminales que no
  caen, concurrencia y rollback.
- `planVigente.test.js`: un solo plan vigente (ACTIVO / NEGOCIACION) por
  cliente — creación y reactivación simultáneas, ruta heredada
  `POST /installments/plans`, sin deadlocks.
- `fechaPago.test.js`: fecha calendario de los pagos (filtros por día,
  métricas del día / mes, resumen mensual, Caja independiente de la fecha).
- `modificacionCuota.http.test.js`: endpoints sobre el servidor real
  (`src/index.js`) — modificación de cuotas, pago dirigido, reactivación,
  403 para VIEWER, 409 por vista previa desactualizada, Caja y pagos intactos.
