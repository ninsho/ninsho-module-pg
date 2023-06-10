import { Pool } from 'pg'

import { IPool, IPoolClient, IPoolConfig, IQueryResult, QE401 } from 'ninsho-base'
import { IResult, QE400, QE404, QE409, QE500, Success } from 'ninsho-base'

export default class ModPg extends IPool {

  internal_version = '0.0'

  private pool: Pool = {} as Pool
  private defaultForceRelease = false

  public static init(config?: IPoolConfig): ModPg {
    const instance = new ModPg()
    instance.pool = new Pool(config)
    instance.defaultForceRelease = config?.forceRelease ? config.forceRelease : false
    return instance
  }

  public async getConnect(): Promise<IPoolClient> {
    return await this.pool.connect()
  }

  public releaseConnect(client: IPoolClient, force = this.defaultForceRelease): void {
    client.release(force)
  }

  public async end(): Promise<void> {
    await this.pool.end()
      // .then(() => # pool end..
      .catch(() => console.log('# catch pool end'))
  }

  // public getPool<T>(): T {
  //   return this.pool as T
  // }

  public async truncate(tableNameList: string[]): Promise<void> {
    const client = await this.pool.connect()
    try {
      for (const tableName of tableNameList) {
        const queryText = `TRUNCATE ${tableName} CASCADE;`; // CASCADE
        await client.query(queryText)
      }
      client.release(true)
    } catch (err) {
      client.release(true)
      console.error('Error occurred during truncate', err)
    }
  }

  public async beginWithClient(): Promise<IPoolClient> {
    const client = await this.getConnect()
    await client.query('BEGIN')
    return client
  }

  public async commitWithRelease(client: IPoolClient, force = this.defaultForceRelease): Promise<void> {
    await client.query('COMMIT')
    client.release(force ? true : false)
  }

  public async rollbackWithRelease(client: IPoolClient, force = this.defaultForceRelease): Promise<void> {
    await client.query('ROLLBACK')
    client.release(force ? true : false)
  }

  public async updateOneOrThrow<T>(
    updateObj: Partial<T>,
    condition: Partial<T>,
    conditionType: 'AND' | 'OR',
    tableName: string,
    client?: IPoolClient
  ): Promise<IResult<IQueryResult<T>, QE500 | QE404>> {

    const query = {
      text: `UPDATE ${tableName} SET `
        + Object.keys(updateObj).map((u, i) => `${u} = $${i + 1}`).join(',')
        + ` WHERE `
        + Object.keys(condition).map((u, i) => `${u} = $${i + 1 + Object.keys(updateObj).length}`).join(' AND ')
        + 'RETURNING id',
      values: Object.values(updateObj).concat(Object.values(condition))
    }

    const pool = !client ? await this.getConnect() : client

    try {
      const res = await pool.query<T>(query)
      if (!client) pool.release(true)
      if (!res || res.rowCount != 1) {
        return new QE404(1002, 'No data found')
      }
      return new Success(res)

    } catch (e: any) {
      if (!client) pool.release(true)
      return new QE500(1005, e.detail)
    }
  }

  public async insert<T>(
    keys: Partial<keyof T>[],
    values: T[Partial<keyof T>][][],
    tableName: string,
    client?: IPoolClient
  ): Promise<IResult<IQueryResult<T>, QE500 | QE400 | QE409>> {

    const keysLength = keys.length
    if (values.some((elm) => elm.length != keysLength)) {
      return new QE400(1008, 'Number of values does not match number of keys')
    }
    if (!keys.length) {
      return new QE400(1011, 'Please specify at least one key')
    }

    // const _values: T[Partial<keyof T>][] = values.flatMap((n) => n)

    const _place = values.map((vs, i) => {
      return `(${keys.map((m, ii) => `$${((keys.length) * i) + 1 + ii}`).join(',')})`
    }).join(',')

    const query = {
      text: `INSERT INTO ${tableName}`
        + ' (' + keys.join(',') + ')'
        + ' VALUES ' + _place
        + ' RETURNING id, m_name',
      values: values.flatMap((n) => n)
    }

    const pool = !client ? await this.getConnect() : client

    try {
      const res = await pool.query<T>(query)
      if (!client) pool.release(true)
      return new Success(res)
    } catch (e: any) {
      if (!client) pool.release(true)
      if (e.code === '23505') {
        console.log(e)
        return new QE409(1014, 'conflict: ' + e.detail)
      }
      return new QE500(1017, e.detail)
    }
  }

  public async insertOne<T>(
    insertObj: Partial<T>,
    tableName: string,
    client: IPoolClient
  ): Promise<IResult<IQueryResult<T>, QE500 | QE409>> {

    const valuesArgv = [...Array(Object.keys(insertObj as Record<string, unknown>).length)].map((_, i) => `$${i + 1}`)
    const query = {
      text: `INSERT INTO ${tableName}(`
        + Object.keys(insertObj as Record<string, unknown>).join(',')
        + `) VALUES(${valuesArgv})`
        + ' RETURNING id',
      values: Object.values(insertObj as Record<string, unknown>)
    }

    try {
      return new Success(await client.query<T>(query))
    } catch (e: any) {
      if (e.code === '23505') {
        return new QE409(1020, 'conflict' + e.detail)
      }
      return new QE500(1023, e.detail)
    }
  }

  public async selectOneOrThrow<T>(
    table: string,
    columns: (keyof T)[] | '*',
    condition: { [key in keyof T]?: T[key] },
    conditionType: 'OR' | 'AND',
    client?: IPoolClient
  ): Promise<IResult<Required<T>, QE500 | QE404>> {

    let query = `SELECT ${columns === '*' ? '*' : columns.join(', ')} FROM ${table}`
    const values: any[] = []
    if (condition) {
      query += ` WHERE ${Object.entries(condition)
        .map(([key, value], i) => {
          values.push(value)
          return `${key} = $${i + 1}`
        })
        .join(' ' + conditionType + ' ')}`
    }

    const pool = !client ? await this.getConnect() : client

    try {
      const res = await pool.query<T>(
        {
          text: query,
          values
        })
      if (!client) pool.release(true)
      if (!res || !res.rowCount) {
        return new QE404(1026, 'No data found')
      }
      return new Success(res.rows[0] as Required<T>)
    } catch (e: any) {
      if (!client) pool.release(true)
      return new QE500(1029, e.detail)
    }
  }

  public async selectOne<T>(
    table: string,
    columns: (keyof T)[],
    condition: { [key in keyof T]?: T[key] },
    client?: IPoolClient
  ): Promise<IResult<Required<T> | null, QE500>> {

    let query = `SELECT ${columns.join(', ')} FROM ${table}`
    const values: any[] = []
    if (Object.keys(condition).length) {
      query += ` WHERE ${Object.entries(condition)
        .map(([key, value], i) => {
          values.push(value)
          return `${key} = $${i + 1}`
        })
        .join(' AND ')}`
    }

    const pool = !client ? await this.getConnect() : client

    try {
      const res = await pool.query<T>(
        {
          text: query,
          values
        })
      if (!client) pool.release(true)
      return new Success(
        res.rowCount
          ? res.rows[0] as Required<T>
          : null
      )

    } catch (e: any) {
      if (!client) pool.release(true)
      return new QE500(1032, e)
    }
  }

  public async select<T>(
    table: string,
    columns: (keyof T)[],
    condition: { [key in keyof T]?: T[key] } | null,
    client?: IPoolClient
  ): Promise<IResult<IQueryResult<T>, QE500>> {

    let query = `SELECT ${columns.join(', ')} FROM ${table}`
    const values: any[] = []
    if (condition && Object.keys(condition).length) {
      query += ` WHERE ${Object.entries(condition)
        .map(([key, value], i) => {
          values.push(value)
          return `${key} = $${i + 1}`
        })
        .join(' AND ')}`
    }

    const pool = !client ? await this.getConnect() : client

    try {
      const res = await pool.query<T>(
        {
          text: query,
          values
        })
      if (!client) pool.release(true)
      return new Success(res)

    } catch (e: any) {
      if (!client) pool.release(true)
      return new QE500(1035, e.detail)
    }
  }

  public async delete<T>(
    condition: Partial<T>,
    tableName: string,
    client?: IPoolClient
  ): Promise<IResult<T, QE500>> {
    const wheresArgv = Object.keys(condition).map((key, i) => {
      return `${key} = $${i + 1}`
    })
    const query = {
      text: `DELETE FROM ${tableName}` + (
        wheresArgv.length ? ` WHERE ` + wheresArgv.join(' AND ') : ''
      ),
      values: Object.values(condition)
    }

    const pool = !client ? await this.getConnect() : client

    try {
      const res = await pool.query<T>(query)
      if (!client) pool.release(true)
      return new Success(res as T)
    } catch (e: any) {
      if (!client) pool.release(true)
      return new QE500(1038, e.detail)
    }
  }

  public async deleteOrThrow<T>(
    condition: Partial<T>,
    tableName: string,
    client?: IPoolClient
  ): Promise<IResult<T, QE500 | QE404>> {
    const wheresArgv = Object.keys(condition).map((key, i) => {
      return `${key} = $${i + 1}`
    })
    const query = {
      text: `DELETE FROM ${tableName}` + (
        wheresArgv.length ? ` WHERE ` + wheresArgv.join(' AND ') : ''
      ),
      values: Object.values(condition)
    }

    const pool = !client ? await this.getConnect() : client

    try {
      const res = await pool.query<T>(query)
      if (!client) pool.release(true)
      if (!res || res.rowCount < 1) {
        return new QE404(1039, 'No data found')
      }
      return new Success(res as T)
    } catch (e: any) {
      if (!client) pool.release(true)
      return new QE500(1040, e.detail)
    }
  }

  public async replaceOneWithConditionExistAndDeadLine<T>(
    insertObj: Partial<T>,
    tableName: string,
    deadLine: number,
    client: IPoolClient
  ): Promise<IResult<IQueryResult<T>, QE500 | QE409>> {

    const valuesArgv
      = [...Array(Object.keys(insertObj as Record<string, unknown>).length)].map((_, i) => `$${i + 1}`)
    const keys = Object.keys(insertObj)
    const set = Object.entries(insertObj).map(([k], i) => `${k} = $${i + 1}`)
    set.shift()

    const query = {
      text: `
        INSERT INTO ${tableName} (
          ${keys}
        )
        VALUES (
          ${valuesArgv}
        )
        ON CONFLICT (m_name) 
        DO UPDATE SET
          ${set.join()},
          created_at = NOW()
        WHERE ${tableName}.m_name = $1
          AND ${this.options.tableName.members}.m_status = 0
          AND ${this.options.tableName.members}.created_at < ((NOW()) - INTERVAL '${deadLine} seconds')
        RETURNING id
        
        `,
      values: Object.values(insertObj as Record<string, unknown>)
    }

    try {
      const res = await client.query<T>(query)
      // console.log('res', res)
      if (!res.rowCount) {
        return new QE409(1041, 'No data found')
      }
      return new Success(res)
    } catch (e: any) {
      if (e.code === '23505') {
        return new QE409(1044, 'conflict' + e.detail)
      }
      return new QE500(1047, e.detail)
    }
  }

  public async retrieveMemberIfSessionPresentOne<T>(
    token: string,
    deadLine: number,
    device: string,
    ip: string,
    memberColumnToRetrieve?: string[] | '*',
    client?: IPoolClient
  ): Promise<IResult<Required<T>, QE500 | QE401>> {

    if (memberColumnToRetrieve && memberColumnToRetrieve != '*') {
      memberColumnToRetrieve = memberColumnToRetrieve.map(
        m => m.replace(/^members\./, this.options.tableName.members + '.'))
    }

    const column = memberColumnToRetrieve === '*' || !memberColumnToRetrieve
      ? '*'
      : 'sub_query.created_time, ' + memberColumnToRetrieve.join(',')

    const text = `
      WITH sub_query AS (
        SELECT ${this.options.tableName.sessions}.m_name, ${this.options.tableName.sessions}.created_time
        FROM ${this.options.tableName.sessions}
        WHERE token = $1 --
        AND created_time > $2 --
        AND m_device = $3 --
        AND m_ip = $4 --
      )
      SELECT ${column}
      FROM ${this.options.tableName.members}
      JOIN sub_query
      ON ${this.options.tableName.members}.m_name = sub_query.m_name
      WHERE EXISTS (
        SELECT 1
        FROM sub_query
      )`

    const pool = !client ? await this.getConnect() : client

    try {
      const res = await pool.query<T>(
        {
          text,
          values: [token, deadLine, device, ip]
        })
      if (!client) pool.release(true)
      if (!res || !res.rowCount) {
        return new QE401(1050) // It is actually 404, but it is operationally 401
      }
      return new Success(res.rows[0] as Required<T>
      )

    } catch (e: any) {
      if (!client) pool.release(true)
      return new QE500(1058, e.detail)
    }
  }

  public async upsertSessionRecord<T>(
    values: Partial<T>,
    onConflictTargets: (keyof T)[],
    updateTargets: (keyof T)[],
    tableName: string,
    client?: IPoolClient
  ): Promise<IResult<IQueryResult<T>, QE500 | QE404>> {

    const col = Object.keys(values).join(',')
    const val = Object.values(values)
    const alt = Array.from(
      {
        length: val.length
      },
      (_, i) => `$${i + 1}`
    ).join(',')
    const onConflict = onConflictTargets.join(',')
    const update = updateTargets.map(m => `${m.toString()} = EXCLUDED.${m.toString()}`).join(',')

    const text = `
      INSERT INTO ${tableName} (${col}) -- col1, col2 ..
      VALUES ( ${alt} ) -- $1,$2..
      ON CONFLICT ( ${onConflict} ) -- (m_name, m_ip, m_device)
      DO UPDATE SET
         -- token = EXCLUDED.token
         ${update}
      ;`
    const pool = !client ? await this.getConnect() : client

    try {
      const res = await pool.query<T>(
        {
          text,
          values: val
        })
      if (!client) pool.release(true)
      return new Success(res)
    } catch (e: any) {
      if (!client) pool.release(true)
      return new QE500(1061, e.detail)
    }
  }
}
