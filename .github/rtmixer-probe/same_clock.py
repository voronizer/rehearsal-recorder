"""Whether perf_counter_ns counts the same in a spawned process as in this
one: the child answers each time it is sent with its own clock less the
sender's. The same clock gives a small positive number, a pipe's trip."""
import multiprocessing as mp, time, json

def child(conn):
    while True:
        sent = conn.recv()
        if sent is None:
            return
        conn.send(time.perf_counter_ns() - sent)

if __name__ == "__main__":
    mp.freeze_support()
    ctx = mp.get_context("spawn")
    here, there = ctx.Pipe()
    p = ctx.Process(target=child, args=(there,), daemon=True)
    p.start()
    trips = []
    for _ in range(200):
        here.send(time.perf_counter_ns()); trips.append(here.recv() / 1e6); time.sleep(0.005)
    here.send(None); p.join()
    trips.sort()
    print(json.dumps({"same_clock_child_minus_parent_ms_min_median_max": [round(trips[0], 3), round(trips[100], 3), round(trips[-1], 3)]}))
