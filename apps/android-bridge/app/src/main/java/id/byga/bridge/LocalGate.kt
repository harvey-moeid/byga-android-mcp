package id.byga.bridge

import android.os.SystemClock

object LocalGate {
    private val gate = OneShotGate { SystemClock.elapsedRealtime() }
    fun grantOne() = gate.grantOne()
    fun stop() = gate.stop()
    fun consume(): Boolean = gate.consume()
}
