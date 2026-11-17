import { DragDropContext, type OnDragEndResponder } from "@hello-pangea/dnd";
import isEqual from "lodash/isEqual";
import {
  useDataProvider,
  useListContext,
  useNotify,
  type DataProvider,
} from "ra-core";
import { useEffect, useRef, useState } from "react";

import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal } from "../types";
import { DealColumn } from "./DealColumn";
import type { DealsByStage } from "./stages";
import { getDealsByStage } from "./stages";

export const DealListContent = () => {
  const { dealStages } = useConfigurationContext();
  const { data: unorderedDeals, isPending, refetch } = useListContext<Deal>();
  const dataProvider = useDataProvider();
  const notify = useNotify();

  const [dealsByStage, setDealsByStage] = useState<DealsByStage>(
    getDealsByStage([], dealStages),
  );

  // While a card is being dragged the columns must not change under it: the
  // drag library cancels the drag (or loses track of the card). Fresh data
  // that lands mid-drag waits here until the drag is over.
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const pendingSaves = useRef(0);
  const dragging = useRef(false);
  const arrivedWhileDragging = useRef(false);

  useEffect(() => {
    if (dragging.current) {
      arrivedWhileDragging.current = true;
      return;
    }
    // Moves still being saved: the server is behind the screen. The reload
    // that follows the last save brings the truth.
    if (pendingSaves.current > 0) return;
    if (unorderedDeals) {
      const newDealsByStage = getDealsByStage(unorderedDeals, dealStages);
      if (!isEqual(newDealsByStage, dealsByStage)) {
        setDealsByStage(newDealsByStage);
      }
    }
    // The stages are a dependency too: the organization's configuration can
    // arrive after the deals, and a column without an entry here cannot render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unorderedDeals, dealStages]);

  if (isPending) return null;

  const onDragStart = () => {
    dragging.current = true;
  };

  /** The drag changed nothing: show what arrived while it lasted, if anything. */
  const settle = () => {
    if (!arrivedWhileDragging.current) return;
    arrivedWhileDragging.current = false;
    if (unorderedDeals) {
      setDealsByStage(getDealsByStage(unorderedDeals, dealStages));
    }
  };

  const onDragEnd: OnDragEndResponder = (result) => {
    const { destination, source } = result;
    dragging.current = false;

    if (!destination) {
      settle();
      return;
    }

    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      settle();
      return;
    }
    // a move reloads the board once it is saved (below)
    arrivedWhileDragging.current = false;

    const sourceStage = source.droppableId;
    const destinationStage = destination.droppableId;
    const sourceDeal = dealsByStage[sourceStage]?.[source.index];
    // The board and its state can disagree for a moment (a reload landing
    // mid-drag). Dropping nothing is better than putting a hole in a column.
    if (!sourceDeal || !dealsByStage[destinationStage]) {
      refetch();
      return;
    }
    // The stage is the column's, not the neighbouring card's: a deal whose
    // stage no longer exists is shown in the first column and must not hand
    // its stale stage to the deals dropped next to it.
    const destinationDeal = {
      stage: destinationStage,
      // the card whose place is taken; undefined if dropped after the last one
      targetId: dealsByStage[destinationStage][destination.index]?.id,
    };

    // compute local state change synchronously
    setDealsByStage(
      updateDealStageLocal(
        sourceDeal,
        { stage: sourceStage, index: source.index },
        { stage: destinationStage, index: destination.index },
        dealsByStage,
      ),
    );

    // Persist the changes. Moves are saved one after the other, each against
    // what the server holds by then: the cards on screen can be a move or two
    // ahead of it, so their own stage and index are not to be trusted.
    pendingSaves.current += 1;
    saveQueue.current = saveQueue.current
      .then(() => updateDealStage(sourceDeal.id, destinationDeal, dataProvider))
      .catch(() => {
        notify("crm.deals.move_error", {
          type: "error",
          messageArgs: { _: "The deal could not be moved. Please try again." },
        });
      })
      .finally(() => {
        pendingSaves.current -= 1;
        // Reload once everything is saved; on failure this puts the card back
        // where the server has it.
        if (pendingSaves.current === 0) refetch();
      });
  };

  return (
    <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex gap-4">
        {dealStages.map((stage) => (
          <DealColumn
            stage={stage.value}
            deals={dealsByStage[stage.value] ?? []}
            key={stage.value}
          />
        ))}
      </div>
    </DragDropContext>
  );
};

const updateDealStageLocal = (
  sourceDeal: Deal,
  source: { stage: string; index: number },
  destination: {
    stage: string;
    index?: number; // undefined if dropped after the last item
  },
  dealsByStage: DealsByStage,
) => {
  if (source.stage === destination.stage) {
    // moving deal inside the same column
    const column = dealsByStage[source.stage];
    column.splice(source.index, 1);
    column.splice(destination.index ?? column.length + 1, 0, sourceDeal);
    return {
      ...dealsByStage,
      [destination.stage]: column,
    };
  } else {
    // moving deal across columns
    const sourceColumn = dealsByStage[source.stage];
    const destinationColumn = dealsByStage[destination.stage];
    sourceColumn.splice(source.index, 1);
    destinationColumn.splice(
      destination.index ?? destinationColumn.length + 1,
      0,
      sourceDeal,
    );
    return {
      ...dealsByStage,
      [source.stage]: sourceColumn,
      [destination.stage]: destinationColumn,
    };
  }
};

const updateDealStage = async (
  sourceId: Deal["id"],
  target: {
    stage: string;
    targetId?: Deal["id"]; // undefined if dropped after the last item
  },
  dataProvider: DataProvider,
) => {
  // the deal as the server has it now
  const { data: source } = await dataProvider.getOne<Deal>("deals", {
    id: sourceId,
  });
  const targetIndex = async () => {
    if (target.targetId == null) return undefined;
    const { data } = await dataProvider.getOne<Deal>("deals", {
      id: target.targetId,
    });
    // a target that has left the column since counts as "after the last one"
    return data.stage === target.stage ? data.index : undefined;
  };
  const destination = { stage: target.stage, index: await targetIndex() };
  if (source.stage === destination.stage) {
    // moving deal inside the same column
    // Fetch all the deals in this stage (because the list may be filtered, but we need to update even non-filtered deals)
    const { data: columnDeals } = await dataProvider.getList("deals", {
      sort: { field: "index", order: "ASC" },
      pagination: { page: 1, perPage: 100 },
      filter: { stage: source.stage },
    });
    const destinationIndex = destination.index ?? columnDeals.length + 1;

    if (source.index > destinationIndex) {
      // deal moved up, eg
      // dest   src
      //  <------
      // [4, 7, 23, 5]
      await Promise.all([
        // for all deals between destinationIndex and source.index, increase the index
        ...columnDeals
          .filter(
            (deal) =>
              deal.index >= destinationIndex && deal.index < source.index,
          )
          .map((deal) =>
            dataProvider.update("deals", {
              id: deal.id,
              data: { index: deal.index + 1 },
              previousData: deal,
            }),
          ),
        // for the deal that was moved, update its index
        dataProvider.update("deals", {
          id: source.id,
          data: { index: destinationIndex },
          previousData: source,
        }),
      ]);
    } else {
      // deal moved down, e.g
      // src   dest
      //  ------>
      // [4, 7, 23, 5]
      await Promise.all([
        // for all deals between source.index and destinationIndex, decrease the index
        ...columnDeals
          .filter(
            (deal) =>
              deal.index <= destinationIndex && deal.index > source.index,
          )
          .map((deal) =>
            dataProvider.update("deals", {
              id: deal.id,
              data: { index: deal.index - 1 },
              previousData: deal,
            }),
          ),
        // for the deal that was moved, update its index
        dataProvider.update("deals", {
          id: source.id,
          data: { index: destinationIndex },
          previousData: source,
        }),
      ]);
    }
  } else {
    // moving deal across columns
    // Fetch all the deals in both stages (because the list may be filtered, but we need to update even non-filtered deals)
    const [{ data: sourceDeals }, { data: destinationDeals }] =
      await Promise.all([
        dataProvider.getList("deals", {
          sort: { field: "index", order: "ASC" },
          pagination: { page: 1, perPage: 100 },
          filter: { stage: source.stage },
        }),
        dataProvider.getList("deals", {
          sort: { field: "index", order: "ASC" },
          pagination: { page: 1, perPage: 100 },
          filter: { stage: destination.stage },
        }),
      ]);
    const destinationIndex = destination.index ?? destinationDeals.length + 1;

    await Promise.all([
      // decrease index on the deals after the source index in the source columns
      ...sourceDeals
        .filter((deal) => deal.index > source.index)
        .map((deal) =>
          dataProvider.update("deals", {
            id: deal.id,
            data: { index: deal.index - 1 },
            previousData: deal,
          }),
        ),
      // increase index on the deals after the destination index in the destination columns
      ...destinationDeals
        .filter((deal) => deal.index >= destinationIndex)
        .map((deal) =>
          dataProvider.update("deals", {
            id: deal.id,
            data: { index: deal.index + 1 },
            previousData: deal,
          }),
        ),
      // change the dragged deal to take the destination index and column
      dataProvider.update("deals", {
        id: source.id,
        data: {
          index: destinationIndex,
          stage: destination.stage,
        },
        previousData: source,
      }),
    ]);
  }
};
